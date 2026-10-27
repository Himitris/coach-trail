"""Strava (optionnel) : OAuth2, jetons, connecteur, quotas, normalisation, déduplication, routes."""

import json
import stat
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.logging import SecretMaskingFilter
from app.main import create_app
from app.models import Activity
from app.strava.auth import SCOPE, TOKEN_FILE, StravaAuth
from app.strava.connector import MARGIN, SOFT_DELAY_S, WARN_QUOTA, StravaConnector
from app.strava.normalize import STRAVA_NORMALIZER
from app.sync.registry import build_sources
from app.sync.service import SyncService
from app.sync.types import STATE_AUTH_REQUIRED, STATE_DOWN, SourceError
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector, activity_payload

SECRET = "strava-secret-CANARY-12345"  # noqa: S105
ACCESS = "access-CANARY-aaaa1111"
REFRESH = "refresh-CANARY-bbbb2222"
NOW = 1_800_000_000.0  # horloge fixe (epoch)


class FakeStrava:
    """Faux serveur Strava (OAuth + API v3), avec en-têtes de quota."""

    def __init__(self) -> None:
        self.activities: list[dict[str, Any]] = []
        self.streams: dict[str, dict[str, Any]] = {}
        self.token_calls: list[dict[str, str]] = []
        self.usage = "5,50"
        self.limit = "200,2000"
        self.status: int | None = None
        self.refresh_to = ("access-NEW-cccc3333", "refresh-NEW-dddd4444")
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/oauth/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.token_calls.append(form)
            if self.status:
                return httpx.Response(self.status, json={"message": "Bad Request"})
            access, refresh = (
                (ACCESS, REFRESH) if form["grant_type"] == "authorization_code" else self.refresh_to
            )
            return httpx.Response(
                200,
                json={
                    "access_token": access,
                    "refresh_token": refresh,
                    "expires_at": NOW + 21600,
                    "athlete": {"id": 42},
                },
            )
        headers = {"X-RateLimit-Limit": self.limit, "X-RateLimit-Usage": self.usage}
        if self.status:
            return httpx.Response(self.status, headers=headers, json={"message": "x"})
        if request.url.path == "/api/v3/athlete/activities":
            page = int(request.url.params["page"])
            per = int(request.url.params["per_page"])
            return httpx.Response(
                200, headers=headers, json=self.activities[(page - 1) * per : page * per]
            )
        if request.url.path.endswith("/streams"):
            ext = request.url.path.split("/")[4]
            if ext in self.streams:
                return httpx.Response(200, headers=headers, json=self.streams[ext])
            return httpx.Response(404, headers=headers, json={})
        return httpx.Response(404, headers=headers)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def strava_activity(ext: int, start: str, minutes: float = 60, **over: Any) -> dict[str, Any]:
    return {
        "id": ext, "sport_type": "TrailRun", "type": "Run", "start_date": start,
        "moving_time": minutes * 60, "elapsed_time": minutes * 60 + 120, "distance": 10_000,
        "total_elevation_gain": 410, "average_heartrate": 141.4, "max_heartrate": 171, **over,
    }  # fmt: skip


def make_auth(tmp_path: Path, fake: FakeStrava, clock: float = NOW) -> StravaAuth:
    return StravaAuth(
        tmp_path / "strava", "12345", SECRET, "https://coach.example/api/strava/callback",
        client=fake.client(), clock=lambda: clock,
    )  # fmt: skip


def connected_auth(tmp_path: Path, fake: FakeStrava, clock: float = NOW) -> StravaAuth:
    auth = make_auth(tmp_path, fake, clock)
    auth.exchange_code("code-xyz")
    return auth


# --- activation ---------------------------------------------------------------------------------


def test_strava_is_disabled_by_default_and_needs_credentials() -> None:
    assert "strava" not in build_sources(Settings())[0]
    assert (
        "strava"
        not in build_sources(Settings(strava_client_id="1", strava_client_secret=SecretStr("s")))[0]
    )
    assert "strava" not in build_sources(Settings(strava_enabled=True))[0]
    connectors, normalizers = build_sources(
        Settings(strava_enabled=True, strava_client_id="1", strava_client_secret=SecretStr("s"))
    )
    assert "strava" in connectors and "strava" in normalizers


# --- OAuth2 et jetons ---------------------------------------------------------------------------


def test_authorize_url_is_read_only_and_state_is_single_use(tmp_path: Path) -> None:
    auth = make_auth(tmp_path, FakeStrava())
    url, state = auth.authorize_url()
    query = parse_qs(urlparse(url).query)
    assert urlparse(url).netloc == "www.strava.com" and query["client_id"] == ["12345"]
    assert query["scope"] == [SCOPE] == ["read,activity:read_all"] and query["state"] == [state]
    assert SECRET not in url
    assert auth.consume_state(state) is True and auth.consume_state(state) is False
    assert auth.consume_state("inconnu") is False


def test_state_expires_after_ten_minutes(tmp_path: Path) -> None:
    now = [NOW]
    auth = StravaAuth(
        tmp_path, "1", SECRET, "https://x/cb", client=FakeStrava().client(), clock=lambda: now[0]
    )
    _, state = auth.authorize_url()
    now[0] += 601
    assert auth.consume_state(state) is False


def test_exchange_stores_tokens_privately_without_the_client_secret(tmp_path: Path) -> None:
    fake = FakeStrava()
    auth = connected_auth(tmp_path, fake)
    path = tmp_path / "strava" / TOKEN_FILE
    assert (
        stat.S_IMODE(path.stat().st_mode) == 0o600
        and stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    )
    stored = json.loads(path.read_text())
    assert stored["access_token"] == ACCESS and stored["athlete_id"] == 42
    assert SECRET not in path.read_text()
    assert fake.token_calls[0]["grant_type"] == "authorization_code" and auth.connected()
    assert (
        auth.access_token() == ACCESS and len(fake.token_calls) == 1
    )  # encore valide : pas de refresh


def test_expiring_token_is_refreshed_and_the_rotated_refresh_token_saved(tmp_path: Path) -> None:
    fake = FakeStrava()
    connected_auth(tmp_path, fake)
    later = make_auth(tmp_path, fake, clock=NOW + 21600 - 60)  # expire dans < 2 min
    assert later.access_token() == "access-NEW-cccc3333"
    assert fake.token_calls[-1] == {
        "client_id": "12345",
        "client_secret": SECRET,
        "grant_type": "refresh_token",
        "refresh_token": REFRESH,
    }
    saved = json.loads((tmp_path / "strava" / TOKEN_FILE).read_text())
    assert saved["refresh_token"] == "refresh-NEW-dddd4444" and saved["athlete_id"] == 42
    assert stat.S_IMODE((tmp_path / "strava" / TOKEN_FILE).stat().st_mode) == 0o600


def test_auth_errors_are_readable_source_errors(tmp_path: Path) -> None:
    fake = FakeStrava()
    auth = make_auth(tmp_path, fake)
    with pytest.raises(SourceError) as not_connected:
        auth.access_token()
    assert (
        not_connected.value.state == STATE_AUTH_REQUIRED
        and "Connecter Strava" in not_connected.value.user_message
    )
    fake.status = 400
    with pytest.raises(SourceError) as refused:
        auth.exchange_code("mauvais")
    assert refused.value.state == STATE_AUTH_REQUIRED and not auth.connected()
    fake.status = 500
    with pytest.raises(SourceError) as down:
        auth.exchange_code("x")
    assert down.value.state == STATE_DOWN


def test_tokens_never_reach_the_logs(tmp_path: Path) -> None:
    connected_auth(tmp_path, FakeStrava())
    masked = SecretMaskingFilter([SECRET]).mask(f"appel avec {ACCESS} et {REFRESH} secret {SECRET}")
    assert ACCESS not in masked and REFRESH not in masked and SECRET not in masked


def test_disconnect_removes_the_tokens(tmp_path: Path) -> None:
    auth = connected_auth(tmp_path, FakeStrava())
    auth.disconnect()
    assert not auth.connected()
    auth.disconnect()  # idempotent


# --- connecteur ---------------------------------------------------------------------------------


def make_connector(
    tmp_path: Path, fake: FakeStrava, sleeps: list[float], clock: float = NOW
) -> StravaConnector:
    auth = connected_auth(tmp_path, fake, clock)
    return StravaConnector(
        auth,
        client=fake.client(),
        today=lambda: date(2026, 10, 15),
        sleep=sleeps.append,
        clock=lambda: clock,
    )


def test_activities_are_paginated_with_the_after_window(tmp_path: Path) -> None:
    fake = FakeStrava()
    fake.activities = [strava_activity(i, "2026-10-01T06:00:00Z") for i in range(1, 151)]
    connector = make_connector(tmp_path, fake, [])
    records = list(connector.fetch_activities(datetime(2026, 10, 1)))
    assert len(records) == 150 and records[0].key == "1"
    calls = [r for r in fake.requests if r.url.path.endswith("/athlete/activities")]
    assert [c.url.params["page"] for c in calls] == ["1", "2"]
    assert calls[0].url.params["after"] == str(int(datetime(2026, 10, 1).timestamp()))
    assert calls[0].headers["authorization"] == f"Bearer {ACCESS}" and "access_token" not in str(
        calls[0].url
    )


def test_default_window_is_the_history(tmp_path: Path) -> None:
    fake = FakeStrava()
    list(make_connector(tmp_path, fake, []).fetch_activities(None))
    after = int(
        next(r for r in fake.requests if r.url.path.endswith("/activities")).url.params["after"]
    )
    assert datetime.fromtimestamp(after).date() == date(2025, 10, 20)


def test_stream_conversion_and_missing_stream(tmp_path: Path) -> None:
    fake = FakeStrava()
    fake.streams["7"] = {
        "time": {"data": [0, 1, 2]},
        "heartrate": {"data": [120, 121, 122]},
        "junk": 5,
    }
    connector = make_connector(tmp_path, fake, [])
    record = connector.fetch_activity_stream("7")
    assert record is not None and record.payload == {
        "streams": {"time": [0, 1, 2], "heartrate": [120, 121, 122]}
    }
    assert connector.fetch_activity_stream("absent") is None
    assert list(connector.fetch_wellness(None)) == []  # Strava : ni HRV, ni sommeil, ni FC repos


@pytest.mark.parametrize(
    ("status", "state"),
    [(401, STATE_AUTH_REQUIRED), (403, STATE_AUTH_REQUIRED), (429, STATE_DOWN), (503, STATE_DOWN)],
)
def test_api_errors_map_to_source_states(tmp_path: Path, status: int, state: str) -> None:
    fake = FakeStrava()
    connector = make_connector(tmp_path, fake, [])
    fake.status = status
    with pytest.raises(SourceError) as err:
        list(connector.fetch_activities(None))
    assert err.value.state == state and ACCESS not in err.value.user_message
    if status == 429:
        assert "Quota Strava dépassé" in err.value.user_message


def test_calls_slow_down_when_a_quota_is_half_used(tmp_path: Path) -> None:
    fake = FakeStrava()
    sleeps: list[float] = []
    fake.activities = [strava_activity(i, "2026-10-01T06:00:00Z") for i in range(1, 121)]
    fake.usage = "101,300"  # 101 / 200 sur 15 min : plus de la moitié
    connector = make_connector(tmp_path, fake, sleeps)
    list(connector.fetch_activities(datetime(2026, 10, 1)))
    assert sleeps == [SOFT_DELAY_S]  # 2e page ralentie, 1re page non
    assert not connector.pop_warnings()


def test_calls_are_not_slowed_when_usage_is_low(tmp_path: Path) -> None:
    fake = FakeStrava()
    sleeps: list[float] = []
    fake.activities = [strava_activity(i, "2026-10-01T06:00:00Z") for i in range(1, 121)]
    list(make_connector(tmp_path, fake, sleeps).fetch_activities(datetime(2026, 10, 1)))
    assert sleeps == []


def test_sync_stops_cleanly_before_the_limit_with_a_warning(tmp_path: Path) -> None:
    fake = FakeStrava()
    fake.activities = [strava_activity(i, "2026-10-01T06:00:00Z") for i in range(1, 251)]
    fake.usage = f"{200 - MARGIN},400"  # à la marge de la limite des 15 min
    sleeps: list[float] = []
    connector = make_connector(
        tmp_path, fake, sleeps, clock=NOW - NOW % 900 + 100
    )  # 800 s avant la fin de fenêtre
    records = list(connector.fetch_activities(datetime(2026, 10, 1)))
    assert len(records) == 100  # la 1re page est conservée, puis arrêt avant le blocage
    assert connector.pop_warnings() == [WARN_QUOTA] and connector.pop_warnings() == []
    assert len([r for r in fake.requests if r.url.path.endswith("/activities")]) == 1
    assert sleeps == []  # pas d'attente de 800 s dans une synchronisation


def test_short_wait_is_honoured(tmp_path: Path) -> None:
    fake = FakeStrava()
    fake.activities = [strava_activity(i, "2026-10-01T06:00:00Z") for i in range(1, 151)]
    fake.usage = f"{200 - MARGIN},400"
    sleeps: list[float] = []
    clock = NOW - NOW % 900 + 880  # 20 s avant la fin de la fenêtre
    list(
        make_connector(tmp_path, fake, sleeps, clock=clock).fetch_activities(datetime(2026, 10, 1))
    )
    assert sleeps == [pytest.approx(20)]


# --- normalisation ------------------------------------------------------------------------------


def test_normalization_maps_sport_race_and_duration() -> None:
    n = STRAVA_NORMALIZER.activity(
        strava_activity(9, "2026-10-10T05:00:00Z", workout_type=1, gear={"name": "Speedcross"})
    )
    assert n is not None
    assert (n.sport, n.duration_s, n.distance_m, n.elevation_gain_m) == (
        "trail_running",
        3600,
        10000,
        410,
    )
    assert (n.hr_avg, n.hr_max, n.is_race, n.gear, n.elevation_loss_m) == (
        141,
        171,
        True,
        "Speedcross",
        None,
    )
    assert n.start.isoformat() == "2026-10-10T05:00:00+00:00"
    ride = STRAVA_NORMALIZER.activity(
        strava_activity(10, "2026-10-10T05:00:00Z", sport_type="Ride", workout_type=1)
    )
    assert (
        ride is not None and ride.sport == "cycling" and ride.is_race is False
    )  # « course » : course à pied seulement
    assert (
        STRAVA_NORMALIZER.activity({"id": 1}) is None
        and STRAVA_NORMALIZER.activity(strava_activity(3, "x")) is None
    )
    assert STRAVA_NORMALIZER.wellness({"id": "2026-10-10", "hrv": 60}) is None


# --- synchronisation et déduplication -----------------------------------------------------------


def test_sync_deduplicates_with_garmin_and_keeps_garmin_first(tmp_path: Path) -> None:
    fake = FakeStrava()
    fake.activities = [
        strava_activity(1, "2026-10-10T05:00:20Z", minutes=61),  # même sortie que Garmin
        strava_activity(
            2, "2026-10-12T05:00:00Z", minutes=50, sport_type="Run"
        ),  # seulement chez Strava
    ]
    fake.streams = {"1": {"time": {"data": [0, 1, 2]}, "heartrate": {"data": [100, 101, 102]}}}
    settings = Settings(database_path=str(tmp_path / "s.db"), scheduler_enabled=False)
    app = create_app(settings)
    garmin = FakeConnector(
        "garmin", activities=[activity_payload("g1", start="2026-10-10T05:00:00+00:00")]
    )
    service = SyncService(
        app.state.session_factory,
        {"garmin": garmin, "strava": make_connector(tmp_path, fake, [])},
        {"garmin": FAKE_NORMALIZER, "strava": STRAVA_NORMALIZER},
        priority=["garmin", "intervals", "strava"],
    )
    with TestClient(app) as client:
        report = service.run_all()
        assert all(r.ok for r in report.results)
        acts = client.get("/api/activities?limit=50").json()
        assert len(acts) == 2 and {a["source"] for a in acts} == {"garmin", "strava"}
        assert next(a for a in acts if a["day"] == "2026-10-10")["source"] == "garmin"
        again = service.run_all()
        assert sum(r.inserted for r in again.results if r.source == "strava") == 0
        with app.state.session_factory() as s:
            assert (
                s.query(Activity).count() == 3
            )  # 2 Garmin/Strava de la même sortie + 1 seulement Strava


def test_strava_failure_does_not_block_garmin(tmp_path: Path) -> None:
    settings = Settings(database_path=str(tmp_path / "f.db"), scheduler_enabled=False)
    app = create_app(settings)
    unconnected = StravaConnector(make_auth(tmp_path, FakeStrava()), client=FakeStrava().client())
    service = SyncService(
        app.state.session_factory,
        {
            "garmin": FakeConnector("garmin", activities=[activity_payload("g1")]),
            "strava": unconnected,
        },
        {"garmin": FAKE_NORMALIZER, "strava": STRAVA_NORMALIZER},
    )
    with TestClient(app) as client:
        report = service.run_all()
        assert [r.ok for r in report.results] == [True, False]
        health = {s["source"]: s for s in client.get("/api/sources/health").json()}
        assert (
            health["strava"]["state"] == "auth_required"
            and "Connecter Strava" in health["strava"]["message"]
        )
        assert len(client.get("/api/activities").json()) == 1


# --- routes -------------------------------------------------------------------------------------


@pytest.fixture
def enabled_client(tmp_path: Path) -> Iterator[tuple[TestClient, FakeStrava, StravaAuth]]:
    settings = Settings(
        database_path=str(tmp_path / "r.db"),
        scheduler_enabled=False,
        strava_enabled=True,
        strava_client_id="12345",
        strava_client_secret=SecretStr(SECRET),
        strava_token_dir=str(tmp_path / "tok"),
    )
    app = create_app(settings)
    fake = FakeStrava()
    auth = StravaAuth(
        settings.strava_token_dir,
        "12345",
        SECRET,
        settings.strava_redirect_uri,
        client=fake.client(),
        clock=lambda: NOW,
    )
    app.state.strava_auth = auth
    with TestClient(app, follow_redirects=False) as client:
        yield client, fake, auth


def test_status_warns_about_the_api_terms_even_when_disabled(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=str(tmp_path / "d.db"), scheduler_enabled=False))
    with TestClient(app) as client:
        body = client.get("/api/strava/status").json()
        assert (body["enabled"], body["requested"], body["connected"]) == (False, False, False)
        assert "1er juin 2026" in body["warning"] and "entraînement d'IA" in body["warning"]
        assert "200 requêtes / 15 min" in body["limits"]
        assert client.post("/api/strava/authorize").status_code == 409
        assert "désactivé" in client.post("/api/strava/authorize").json()["detail"]
        assert client.get("/api/strava/callback?code=x&state=y").status_code == 409
        assert SECRET not in json.dumps(body)


def test_enabled_without_credentials_explains_what_is_missing(tmp_path: Path) -> None:
    app = create_app(
        Settings(database_path=str(tmp_path / "e.db"), scheduler_enabled=False, strava_enabled=True)
    )
    with TestClient(app) as client:
        body = client.get("/api/strava/status").json()
        assert (
            body["requested"] is True and body["configured"] is False and body["enabled"] is False
        )
        assert "STRAVA_CLIENT_ID" in client.post("/api/strava/authorize").json()["detail"]


def test_full_oauth_round_trip(enabled_client: tuple[TestClient, FakeStrava, StravaAuth]) -> None:
    client, fake, auth = enabled_client
    assert client.get("/api/strava/status").json()["enabled"] is True
    url = client.post("/api/strava/authorize").json()["url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    back = client.get(f"/api/strava/callback?code=abc&state={state}")
    assert back.status_code == 303 and back.headers["location"] == "/sources?strava=ok"
    assert auth.connected() and fake.token_calls[0]["code"] == "abc"
    assert client.get("/api/strava/status").json()["connected"] is True
    replay = client.get(f"/api/strava/callback?code=abc&state={state}")
    assert replay.headers["location"] == "/sources?strava=refuse"  # état à usage unique
    assert client.post("/api/strava/disconnect").status_code == 204
    assert client.get("/api/strava/status").json()["connected"] is False


@pytest.mark.parametrize(
    "query", ["code=abc&state=faux", "error=access_denied&state=x", "state=x", "code=abc"]
)
def test_callback_rejects_bad_state_denial_or_missing_params(
    enabled_client: tuple[TestClient, FakeStrava, StravaAuth], query: str
) -> None:
    client, fake, auth = enabled_client
    client.post("/api/strava/authorize")
    r = client.get(f"/api/strava/callback?{query}")
    assert r.status_code == 303 and r.headers["location"] == "/sources?strava=refuse"
    assert not auth.connected() and fake.token_calls == []


def test_callback_survives_a_failing_token_exchange(
    enabled_client: tuple[TestClient, FakeStrava, StravaAuth],
) -> None:
    client, fake, auth = enabled_client
    state = parse_qs(urlparse(client.post("/api/strava/authorize").json()["url"]).query)["state"][0]
    fake.status = 500
    r = client.get(f"/api/strava/callback?code=abc&state={state}")
    assert r.headers["location"] == "/sources?strava=erreur" and not auth.connected()
