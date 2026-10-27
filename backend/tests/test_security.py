"""Revue sécurité automatisée : ports, secrets, en-têtes Caddy, CORS, journaux, jetons."""

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.sync.service import SyncService
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
ROOT = DEPLOY.parent
# les chemins (GARMIN_TOKEN_DIR) ne sont pas des secrets
SECRET_NAME = re.compile(r"^(?!.*_DIR$).*(KEY|SECRET|TOKEN|PASSWORD|PASS)", re.IGNORECASE)


@pytest.fixture(scope="module")
def compose() -> dict[str, Any]:
    data = yaml.safe_load((DEPLOY / "docker-compose.yml").read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_only_caddy_publishes_ports_and_only_on_the_tailscale_ip(compose: dict[str, Any]) -> None:
    services = compose["services"]
    published = {name: s["ports"] for name, s in services.items() if "ports" in s}
    assert set(published) == {"caddy"}
    for mapping in published["caddy"]:
        assert str(mapping).startswith("${TAILSCALE_IP"), mapping
        assert "0.0.0.0" not in str(mapping)  # noqa: S104
    assert set(services["api"]["expose"]) == {"8000"}
    assert set(services["web"]["expose"]) == {"80"}


def test_compose_holds_no_literal_secret(compose: dict[str, Any]) -> None:
    for name, service in compose["services"].items():
        for key, value in service.get("environment", {}).items():
            if SECRET_NAME.search(key):
                assert str(value).startswith("${"), f"{name}.{key} doit venir de l'environnement"


def test_backup_volume_is_mandatory_and_separate_from_data(compose: dict[str, Any]) -> None:
    volumes = compose["services"]["api"]["volumes"]
    backup = next(v for v in volumes if str(v).endswith(":/backup"))
    assert backup.startswith("${BACKUP_HOST_DIR:?")
    assert not any("/backup" in str(v) for v in volumes if v != backup)


def test_secrets_never_committed() -> None:
    gitignore = (ROOT / ".gitignore").read_text()
    assert re.search(r"^\.env$", gitignore, re.MULTILINE)
    assert not (ROOT / ".env").exists() and not (DEPLOY / ".env").exists()
    example = (ROOT / ".env.example").read_text()
    for line in example.splitlines():
        key, _, value = line.partition("=")
        if SECRET_NAME.search(key) and not line.startswith("#"):
            assert value == "", f"{key} ne doit pas avoir de valeur dans .env.example"


def test_caddy_sets_security_headers() -> None:
    caddyfile = (DEPLOY / "caddy" / "Caddyfile").read_text()
    for header in (
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy",
        "-Server",
    ):
        assert header in caddyfile
    csp = re.search(r'Content-Security-Policy "([^"]+)"', caddyfile)
    assert csp is not None
    policy = csp.group(1)
    assert "default-src 'self'" in policy and "frame-ancestors 'none'" in policy
    assert "unsafe-eval" not in policy and "http" not in policy  # aucune origine externe
    assert 'Cache-Control "no-store"' in caddyfile


def test_checked_in_scripts_are_executable() -> None:
    for script in ("check.sh", "restore.sh"):
        assert (DEPLOY / script).stat().st_mode & 0o111, script


# --- API ------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "s.db"), scheduler_enabled=False)
    with TestClient(create_app(settings)) as c:
        yield c


def test_cors_is_closed(client: TestClient) -> None:
    origin = {"Origin": "https://evil.example"}
    preflight = client.options(
        "/api/health", headers={**origin, "Access-Control-Request-Method": "GET"}
    )
    assert preflight.status_code == 405
    for response in (preflight, client.get("/api/health", headers=origin)):
        assert not any(h.lower().startswith("access-control-") for h in response.headers)


def test_logs_never_contain_secrets(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    canary_key, canary_password = "ik-CANARY-0123456789", "Pw-CANARY-9876543210"  # noqa: S105
    settings = Settings(
        database_path=str(tmp_path / "l.db"),
        scheduler_enabled=False,
        intervals_api_key=SecretStr(canary_key),
        strava_client_secret=SecretStr("strava-CANARY-5555"),
    )
    app = create_app(settings)
    connector = FakeConnector("garmin")
    connector.fail = RuntimeError(f"401 api_key={canary_key} strava-CANARY-5555")
    app.state.sync_service = SyncService(
        app.state.session_factory,
        {"garmin": connector},
        {"garmin": FAKE_NORMALIZER},
        secrets=settings.secret_values(),
    )
    with TestClient(app) as client:
        client.post("/api/sync/run")
        client.post("/api/garmin/login", json={"email": "x@y.z", "password": canary_password})
        client.post("/api/garmin/login", json={"email": 5, "password": canary_password})  # 422
        client.get("/api/sources/health")
    captured = capsys.readouterr()
    output = captured.err + captured.out
    assert output.strip(), "le test doit observer de vrais journaux"
    for canary in (canary_key, canary_password, "strava-CANARY-5555"):
        assert canary not in output
