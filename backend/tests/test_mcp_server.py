"""Serveur MCP : outils en lecture seule, transports stdio et HTTP, jeton optionnel."""

import json
import sys
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from mcp import Client, StdioServerParameters
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.mcp_server import (
    BearerTokenMiddleware,
    HttpReadApi,
    ReadApi,
    build_server,
    http_app,
)
from tests.test_export import SECRET, seed

TODAY = date(2026, 10, 15)
TOOLS = {
    "get_profile",
    "get_week_summary",
    "get_activities",
    "get_activity_detail",
    "get_recovery",
    "get_fitness",
    "get_plan",
    "export_markdown",
}


class RecordingClient(TestClient):
    """TestClient qui note chaque méthode HTTP utilisée."""

    methods: list[str]

    def request(self, method: str, url: Any, **kwargs: Any) -> Any:
        self.methods.append(method.upper())
        return super().request(method, url, **kwargs)


@pytest.fixture
def api_client(tmp_path: Path) -> Iterator[RecordingClient]:
    settings = Settings(
        database_path=str(tmp_path / "m.db"),
        scheduler_enabled=False,
        intervals_api_key=SecretStr(SECRET),
    )
    app = create_app(settings)
    app.state.today = lambda: TODAY
    client = RecordingClient(app)
    client.methods = []
    with client:
        seed(client)
        client.methods.clear()
        yield client


@pytest.fixture
def mcp(api_client: RecordingClient) -> Client:
    server = build_server(HttpReadApi("", client=api_client), today=lambda: TODAY)
    return Client(server)


async def call(client: Client, name: str, **arguments: Any) -> str:
    result = await client.call_tool(name, arguments)
    assert not result.is_error, result
    return "".join(getattr(block, "text", "") for block in result.content)


async def test_lists_exactly_the_read_only_tools(mcp: Client) -> None:
    async with mcp as client:
        tools = (await client.list_tools()).tools
    assert {t.name for t in tools} == TOOLS
    for tool in tools:
        assert tool.annotations is not None
        assert (
            tool.annotations.read_only_hint is True and tool.annotations.destructive_hint is False
        )
        assert tool.description and any(
            w in tool.description for w in ("de", "des", "du", "la")
        )  # français
        assert not tool.name.startswith(
            ("create", "update", "delete", "set", "post", "put", "import")
        )


async def test_profile_and_goals(mcp: Client) -> None:
    async with mcp as client:
        text = await call(client, "get_profile")
    assert "FC max 195 bpm" in text and "Z1 ≥ 98 bpm" in text
    assert "Trail des 3 Rocs le 2026-11-08 (dans 24 j)" in text
    assert "preuve : mesure" in text


async def test_week_summary_and_default_week(mcp: Client) -> None:
    async with mcp as client:
        text = await call(client, "get_week_summary", date="2026-10-07")
        default = await call(client, "get_week_summary")
    assert "Semaine du 2026-10-05 au 2026-10-11" in text
    assert "3 séance(s)" in text
    assert "jamais un prédicteur de blessure" in text and "preuve : mesure" in text
    assert "Semaine du 2026-10-12" in default and "(en cours)" in default


async def test_activities_and_detail(mcp: Client) -> None:
    async with mcp as client:
        listing = await call(
            client, "get_activities", **{"from_": "2026-10-01", "to": "2026-10-15"}
        )
        first_id = listing.splitlines()[1].split(" | ")[0]
        detail = await call(client, "get_activity_detail", id=int(first_id))
        recent = await call(client, "get_activities", limit=1)
    lines = listing.splitlines()
    assert lines[0].startswith("id | date | sport") and len(lines) == 1 + 3 + 1
    assert "(course)" in listing and "preuve : mesure (montre)" in listing
    assert "## Détail de séance" in detail
    assert len(recent.splitlines()) == 1 + 1 + 1


async def test_recovery_keeps_watch_scores_labelled(mcp: Client) -> None:
    async with mcp as client:
        text = await call(client, "get_recovery", **{"from_": "2026-10-08", "to": "2026-10-15"})
    assert "tendances, pas de feu vert/rouge" in text
    assert "HRV nocturne : moyenne 7 j" in text and "tendance" in text
    assert "Avis de la montre (propriétaires, non validés)" in text
    assert "Training Readiness : 62 (avis Garmin, non validé)" in text
    assert text.count("\n20") >= 7  # valeurs quotidiennes de la période seulement
    assert "2026-10-07" not in text and "preuve : indicatif" in text


async def test_fitness_plan_and_export(mcp: Client) -> None:
    async with mcp as client:
        fitness = await call(client, "get_fitness", **{"from_": "2026-09-21", "to": "2026-10-15"})
        plan = await call(client, "get_plan", week="2026-10-06")
        export = await call(
            client, "export_markdown", **{"from_": "2026-09-21", "to": "2026-10-15"}
        )
    assert "date | charge | CTL | ATL | TSB" in fitness and "Rampe CTL 4 sem." in fitness
    assert "preuve : indicatif" in fitness and "verdict" in fitness
    assert (
        "Côtes (Côtes, 60 min, Z3-4) → fait" in plan
        and "Footing (Footing, 45 min) → manqué" in plan
    )
    assert export.startswith("# Coach Trail — export du 15 oct. 2026")
    assert "## Glossaire des métriques et niveau de preuve" in export


async def test_only_get_requests_are_ever_made(mcp: Client, api_client: RecordingClient) -> None:
    async with mcp as client:
        for name, args in [
            ("get_profile", {}),
            ("get_week_summary", {}),
            ("get_activities", {}),
            ("get_activity_detail", {"id": 1}),
            ("get_recovery", {}),
            ("get_fitness", {}),
            ("get_plan", {}),
            ("export_markdown", {}),
        ]:
            await client.call_tool(name, args)
    assert api_client.methods and set(api_client.methods) == {"GET"}


def test_the_read_api_has_no_write_operation() -> None:
    assert [n for n in dir(ReadApi) if not n.startswith("_")] == ["get"]
    assert not any(
        hasattr(HttpReadApi, m) for m in ("post", "put", "patch", "delete", "request", "send")
    )


async def test_unwritable_data_stays_unchanged(mcp: Client, api_client: RecordingClient) -> None:
    before = api_client.get("/api/plan/sessions?from=2026-09-01&to=2026-12-31").json()
    entries_before = api_client.get("/api/entries?from=2026-09-01&to=2026-10-31").json()
    async with mcp as client:
        await call(client, "get_plan")
        await call(client, "export_markdown")
    assert api_client.get("/api/plan/sessions?from=2026-09-01&to=2026-12-31").json() == before
    assert api_client.get("/api/entries?from=2026-09-01&to=2026-10-31").json() == entries_before


async def test_tool_errors_are_readable(mcp: Client) -> None:
    async with mcp as client:
        bad_date = await client.call_tool("get_week_summary", {"date": "demain"})
        reversed_period = await client.call_tool(
            "get_activities", {"from_": "2026-10-10", "to": "2026-10-01"}
        )
        missing = await client.call_tool("get_activity_detail", {"id": 99999})
    for result in (bad_date, reversed_period, missing):
        assert result.is_error
    texts = [getattr(r.content[0], "text", "") for r in (bad_date, reversed_period, missing)]
    assert "AAAA-MM-JJ" in texts[0] and "doit précéder" in texts[1] and "introuvable" in texts[2]


async def test_api_down_gives_a_clean_error() -> None:
    def refuse(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refus")

    api = HttpReadApi(
        "http://api",
        client=httpx.Client(transport=httpx.MockTransport(refuse), base_url="http://api"),
    )
    async with Client(build_server(api, today=lambda: TODAY)) as client:
        result = await client.call_tool("get_profile", {})
    assert result.is_error and "injoignable" in getattr(result.content[0], "text", "")


# --- jeton partagé --------------------------------------------------------------------------------

INIT = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "t", "version": "1"},
    },
}
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def http_client(token: str) -> TestClient:
    settings = Settings(mcp_token=SecretStr(token))
    server = build_server(HttpReadApi("http://api"))
    return TestClient(http_app(server, settings), base_url="http://127.0.0.1:8765")


def test_token_disabled_by_default_lets_requests_through() -> None:
    with http_client("") as client:
        assert client.post("/mcp", json=INIT, headers=HEADERS).status_code == 200


def test_token_required_when_configured() -> None:
    with http_client("s3cret-token") as client:
        none = client.post("/mcp", json=INIT, headers=HEADERS)
        wrong = client.post("/mcp", json=INIT, headers={**HEADERS, "Authorization": "Bearer nope"})
        scheme = client.post(
            "/mcp", json=INIT, headers={**HEADERS, "Authorization": "Basic s3cret-token"}
        )
        ok = client.post(
            "/mcp", json=INIT, headers={**HEADERS, "Authorization": "Bearer s3cret-token"}
        )
    assert [r.status_code for r in (none, wrong, scheme)] == [401, 401, 401]
    assert none.headers["www-authenticate"] == "Bearer" and "s3cret-token" not in none.text
    assert ok.status_code == 200


def test_unknown_host_is_refused_by_dns_rebinding_protection() -> None:
    settings = Settings(mcp_allowed_hosts="coach.himitris.fr:*")
    app = http_app(build_server(HttpReadApi("http://api")), settings)
    with TestClient(app, base_url="http://evil.example:8765") as client:
        assert client.post("/mcp", json=INIT, headers=HEADERS).status_code in (400, 403, 421)


async def test_middleware_ignores_non_http_scopes() -> None:
    seen: list[str] = []

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        seen.append(scope["type"])

    await BearerTokenMiddleware(inner, "tok")({"type": "lifespan"}, None, None)  # type: ignore[arg-type]
    assert seen == ["lifespan"]


def test_token_is_masked_in_logs() -> None:
    assert "tok-123" in Settings(mcp_token=SecretStr("tok-123")).secret_values()


# --- stdio ----------------------------------------------------------------------------------------


async def test_stdio_transport_lists_the_same_tools() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp_server", "--transport", "stdio"],
        env={"MCP_API_URL": "http://127.0.0.1:9", "PATH": "/usr/bin:/bin"},
        cwd=str(Path(__file__).resolve().parents[1]),
    )
    async with Client(params) as client:
        tools = (await client.list_tools()).tools
        result = await client.call_tool("get_profile", {})
    assert {t.name for t in tools} == TOOLS
    assert result.is_error and "injoignable" in json.dumps(
        [getattr(c, "text", "") for c in result.content]
    )
