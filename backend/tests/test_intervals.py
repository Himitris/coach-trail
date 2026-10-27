"""Intervals.icu : connecteur, normalisation, repli automatique et retour à Garmin."""

import base64
import json
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import func, select

from app.config import Settings
from app.intervals.connector import IntervalsConnector
from app.intervals.normalize import INTERVALS_NORMALIZER
from app.main import create_app
from app.models import Activity, PlannedSession, RawPayload, WellnessDaily
from app.sync.registry import build_sources
from app.sync.service import RunReport, SyncService
from app.sync.types import STATE_AUTH_REQUIRED, STATE_DOWN, SourceError
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector, activity_payload

KEY = "icu-KEY-canary-12345"  # noqa: S105
TODAY = date(2026, 10, 15)


class FakeIntervals:
    """Faux serveur Intervals.icu (httpx.MockTransport)."""

    def __init__(self) -> None:
        self.activities: list[dict[str, Any]] = []
        self.wellness: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.streams: dict[str, list[dict[str, Any]]] = {}
        self.status: int | None = None  # statut forcé pour toutes les requêtes
        self.error: Exception | None = None
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if self.status is not None:
            return httpx.Response(self.status, text=f"boom {request.headers['authorization']}")
        path = request.url.path.removeprefix("/api/v1")
        if path == "/athlete/i123":
            return httpx.Response(200, json={"id": "i123"})
        if path == "/athlete/i123/activities":
            return httpx.Response(200, json=self.activities)
        if path == "/athlete/i123/wellness":
            return httpx.Response(200, json=self.wellness)
        if path == "/athlete/i123/events":
            return httpx.Response(200, json=self.events)
        if path.startswith("/activity/") and path.endswith("/streams"):
            ext = path.split("/")[2]
            if ext in self.streams:
                return httpx.Response(200, json=self.streams[ext])
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(404)

    def connector(self) -> IntervalsConnector:
        return IntervalsConnector(
            "i123",
            KEY,
            client=httpx.Client(transport=httpx.MockTransport(self.handler)),
            today=lambda: TODAY,
        )

    def paths(self) -> list[str]:
        return [r.url.path.removeprefix("/api/v1") for r in self.requests]


def icu_activity(ext: str, start: str, minutes: float = 60, **over: Any) -> dict[str, Any]:
    return {
        "id": ext,
        "type": "TrailRun",
        "start_date": start,
        "start_date_local": start.removesuffix("Z"),
        "moving_time": minutes * 60,
        "elapsed_time": minutes * 60 + 90,
        "distance": 10000,
        "total_elevation_gain": 410,
        "average_heartrate": 141,
        "max_heartrate": 171,
        "calories": 705,
        **over,
    }


def icu_stream(n: int = 6) -> list[dict[str, Any]]:
    return [
        {"type": "time", "data": list(range(n))},
        {"type": "heartrate", "data": [120 + i for i in range(n)]},
        {"type": "altitude", "data": [300.0 + i for i in range(n)]},
        {"type": "velocity_smooth", "data": [2.5] * n},
        {"type": "distance", "data": [2.5 * i for i in range(n)]},
    ]


# --- connecteur ---------------------------------------------------------------------------------


def test_connector_uses_basic_auth_with_the_key_only_in_the_header() -> None:
    fake = FakeIntervals()
    fake.activities = [icu_activity("i1", "2026-10-10T05:00:00Z")]
    records = list(fake.connector().fetch_activities(datetime(2026, 10, 1)))
    assert [r.key for r in records] == ["i1"]
    request = fake.requests[0]
    token = base64.b64decode(request.headers["authorization"].removeprefix("Basic ")).decode()
    assert token == f"API_KEY:{KEY}"
    assert KEY not in str(request.url)
    assert dict(request.url.params) == {"oldest": "2026-10-01", "newest": "2026-10-16"}


def test_connector_default_window_is_the_history() -> None:
    fake = FakeIntervals()
    list(fake.connector().fetch_wellness(None))
    assert fake.requests[0].url.params["oldest"] == "2025-10-20"  # 12 mois de 30 jours


def test_stream_and_calendar_and_health() -> None:
    fake = FakeIntervals()
    fake.streams["i1"] = icu_stream()
    fake.events = [{"id": 9, "name": "Sortie longue", "start_date_local": "2026-10-18T00:00:00"}]
    connector = fake.connector()
    assert connector.healthcheck().ok
    record = connector.fetch_activity_stream("i1")
    assert record is not None and set(record.payload["streams"]) >= {"time", "heartrate"}
    assert connector.fetch_activity_stream("absent") is None  # 404 : pas de flux
    assert [r.key for r in connector.fetch_calendar(None)] == ["9"]
    assert fake.requests[-1].url.params["newest"] == "2026-12-14"  # calendrier : 60 jours devant


@pytest.mark.parametrize(
    ("status", "state"),
    [(401, STATE_AUTH_REQUIRED), (403, STATE_AUTH_REQUIRED), (429, STATE_DOWN), (500, STATE_DOWN)],
)
def test_errors_become_readable_source_errors_without_the_key(status: int, state: str) -> None:
    fake = FakeIntervals()
    fake.status = status
    with pytest.raises(SourceError) as info:
        fake.connector().healthcheck()
    assert info.value.state == state
    assert KEY not in info.value.user_message and "Basic" not in info.value.user_message


def test_network_failure_is_a_down_source_error() -> None:
    fake = FakeIntervals()
    fake.error = httpx.ConnectTimeout(f"timeout {KEY}")
    with pytest.raises(SourceError) as info:
        list(fake.connector().fetch_activities(None))
    assert info.value.state == STATE_DOWN and KEY not in info.value.user_message


def test_unknown_athlete_asks_to_check_the_configuration() -> None:
    fake = FakeIntervals()
    connector = IntervalsConnector(
        "autre", KEY, client=httpx.Client(transport=httpx.MockTransport(fake.handler))
    )
    with pytest.raises(SourceError, match="INTERVALS_ATHLETE_ID"):
        connector.healthcheck()


def test_build_sources_enables_intervals_only_when_configured() -> None:
    connectors, _ = build_sources(Settings())
    assert set(connectors) == {"garmin"}
    configured = Settings(intervals_athlete_id="i123", intervals_api_key=SecretStr(KEY))
    connectors, normalizers = build_sources(configured)
    assert set(connectors) == {"garmin", "intervals"}
    assert set(normalizers) == {"garmin", "intervals", "import"}  # « import » : sans connecteur


# --- normalisation ------------------------------------------------------------------------------


def test_activity_normalization_maps_sport_race_and_gear() -> None:
    payload = icu_activity("i1", "2026-10-10T05:00:00Z", race=True, gear={"name": "Speedcross"})
    n = INTERVALS_NORMALIZER.activity(payload)
    assert n is not None
    assert (n.sport, n.duration_s, n.distance_m, n.elevation_gain_m) == (
        "trail_running",
        3600,
        10000,
        410,
    )
    assert (n.hr_avg, n.hr_max, n.calories, n.gear, n.is_race) == (
        141,
        171,
        705,
        "Speedcross",
        True,
    )
    assert n.elevation_loss_m is None  # absent : jamais inventé
    assert n.start.isoformat() == "2026-10-10T05:00:00+00:00"
    run = INTERVALS_NORMALIZER.activity(icu_activity("i2", "2026-10-10T05:00:00Z", type="Run"))
    assert run is not None and run.sport == "running" and run.is_race is False
    odd = INTERVALS_NORMALIZER.activity(icu_activity("i3", "2026-10-10T05:00:00Z", type="Kayaking"))
    assert odd is not None and odd.sport == "kayaking"


@pytest.mark.parametrize(
    "payload",
    [
        {"id": "i9", "_note": "STRAVA activities are not available via the API"},
        icu_activity("i9", "pas une date"),
        icu_activity("i9", "2026-10-10T05:00:00Z", moving_time=None, elapsed_time=None),
        {"id": None},
        {"id": "i9", "start_date": 12},
    ],
)
def test_unusable_activities_are_skipped_without_error(payload: dict[str, Any]) -> None:
    assert INTERVALS_NORMALIZER.activity(payload) is None


def test_stream_normalization_keeps_equal_length_columns() -> None:
    n = INTERVALS_NORMALIZER.stream({"streams": {s["type"]: s["data"] for s in icu_stream()}})
    assert n is not None and set(n.samples) == {"t", "fc", "altitude", "speed", "distance"}
    short = {"time": [0, 1, 2], "heartrate": [100, 101]}
    got = INTERVALS_NORMALIZER.stream({"streams": short})
    assert got is not None and set(got.samples) == {"t"}
    assert INTERVALS_NORMALIZER.stream({"streams": {"heartrate": [1]}}) is None
    assert INTERVALS_NORMALIZER.stream({}) is None


def test_wellness_normalization_leaves_garmin_proprietary_fields_empty() -> None:
    w = INTERVALS_NORMALIZER.wellness(
        {
            "id": "2026-10-10",
            "hrv": 61.5,
            "restingHR": 48,
            "sleepSecs": 26000,
            "weight": 68.2,
            "ctl": 41.2,
            "atl": 50.1,
            "readiness": 80,
        }  # fmt: skip
    )
    assert w is not None
    assert (w.hrv_nuit, w.fc_repos, w.sommeil_duree_s, w.poids_kg) == (61.5, 48, 26000, 68.2)
    assert (w.source_ctl, w.source_atl) == (41.2, 50.1)
    assert w.training_readiness is None and w.body_battery_max is None and w.hrv_base_min is None
    assert INTERVALS_NORMALIZER.wellness({"id": "n'importe quoi"}) is None


# --- scénario complet : Garmin coupé -> bascule -> Garmin revient -------------------------------


class World:
    def __init__(self, tmp_path: Path) -> None:
        settings = Settings(
            database_path=str(tmp_path / "i.db"),
            garmin_token_dir=str(tmp_path / "tokens"),
            scheduler_enabled=False,
        )
        self.app = create_app(settings)
        self.app.state.today = lambda: TODAY
        self.garmin = FakeConnector("garmin")
        self.icu = FakeIntervals()
        self.service = SyncService(
            self.app.state.session_factory,
            {"garmin": self.garmin, "intervals": self.icu.connector()},
            {"garmin": FAKE_NORMALIZER, "intervals": INTERVALS_NORMALIZER},
            fallbacks={"garmin": "intervals"},
        )
        self.app.state.sync_service = self.service
        self.client = TestClient(self.app)

    def run(self) -> RunReport:
        return self.service.run_all("test")

    def count(self, model: Any, *where: Any) -> int:
        with self.app.state.session_factory() as s:
            return int(s.scalar(select(func.count()).select_from(model).where(*where)) or 0)

    def activities(self) -> list[dict[str, Any]]:
        data: list[dict[str, Any]] = self.client.get("/api/activities?limit=100").json()
        return data

    def health(self) -> dict[str, dict[str, Any]]:
        return {s["source"]: s for s in self.client.get("/api/sources/health").json()}


@pytest.fixture
def world(tmp_path: Path) -> Iterator[World]:
    w = World(tmp_path)
    with w.client:
        yield w


def garmin_act(ext: str, start: str, **over: Any) -> dict[str, Any]:
    return activity_payload(ext, start=start, hr_avg=None, calories=None, **over)


def test_intervals_stays_silent_while_garmin_works(world: World) -> None:
    world.garmin.activities = [garmin_act("g1", "2026-10-10T05:00:00+00:00")]
    report = world.run()
    assert [r.source for r in report.results] == ["garmin"] and report.results[0].ok
    assert world.icu.requests == []  # aucun appel Intervals.icu
    assert world.health()["intervals"]["state"] == "jamais_synchronise"
    assert "repli" in (world.health()["intervals"]["message"] or "")


def test_full_fallback_scenario(world: World) -> None:
    # 1. Garmin fonctionne
    world.garmin.activities = [garmin_act("g1", "2026-10-10T05:00:00+00:00")]
    world.run()
    assert world.health()["garmin"]["state"] == "ok"

    # 2. Garmin tombe : Intervals.icu connaît la même sortie (+ données manquantes) et une nouvelle
    world.garmin.fail = SourceError(STATE_AUTH_REQUIRED, "Session Garmin expirée.")
    world.icu.activities = [
        icu_activity("i1", "2026-10-10T05:00:20Z", minutes=61),  # même sortie que g1 (±60 s, ±5 %)
        icu_activity("i2", "2026-10-13T05:00:00Z", minutes=50, type="Run"),
    ]
    world.icu.streams = {"i1": icu_stream(), "i2": icu_stream()}
    world.icu.wellness = [
        {
            "id": "2026-10-13",
            "hrv": 60.0,
            "restingHR": 49,
            "sleepSecs": 25000,
            "ctl": 999.0,
            "atl": 888.0,
        },
        {"id": "2026-10-14", "hrv": 63.0, "restingHR": 48, "sleepSecs": 26000},
    ]
    world.icu.events = [{"id": 5, "name": "Sortie longue"}]
    report = world.run()  # aucune exception : le run se termine normalement
    garmin_result, icu_result = report.results
    assert garmin_result.ok is False and "expirée" in (garmin_result.error or "")
    assert (
        icu_result.source == "intervals" and icu_result.ok and icu_result.fallback_for == "garmin"
    )
    assert icu_result.inserted > 0

    # badge « Garmin indisponible depuis le … », valeurs conservées, aucune erreur bloquante
    health = world.health()
    assert health["garmin"]["state"] == "auth_required"
    assert health["garmin"]["badge"].startswith("Garmin indisponible depuis le ")
    assert health["intervals"]["state"] == "ok"

    # pas de doublon : g1 et i1 ne font qu'une séance, la version Garmin prévaut et est comblée
    acts = world.activities()
    assert len(acts) == 2
    merged = next(a for a in acts if a["source"] == "garmin")
    assert merged["hr_avg"] == 141 and merged["calories"] == 705  # comblés depuis Intervals.icu
    assert merged["duration_min"] == 60  # durée Garmin conservée
    assert next(a for a in acts if a["source"] == "intervals")["sport"] == "running"

    # le flux d'Intervals.icu sert quand Garmin n'en a pas (détail de séance)
    assert world.client.get(f"/api/activities/{merged['id']}").json()["stream"] is not None

    # bien-être de repli ; champs propriétaires vides, dit clairement
    recovery = world.client.get("/api/metrics/recovery").json()
    assert recovery["fallback"]["source"] == "intervals"
    assert "non disponible via Intervals.icu" in recovery["fallback"]["message"]
    assert recovery["training_readiness"]["value"] is None
    points = world.client.get("/api/metrics/wellness?days=7").json()["points"]
    assert {p["date"] for p in points} == {"2026-10-13", "2026-10-14"}
    assert all(p["training_readiness"] is None and p["body_battery_max"] is None for p in points)

    # CTL/ATL d'Intervals.icu : stockés à part, comparés, jamais utilisés
    fitness = world.client.get("/api/metrics/fitness?from=2026-10-01&to=2026-10-15").json()
    assert (
        fitness["reference"]["source_ctl"] == 999.0
        and fitness["reference"]["source"] == "intervals"
    )
    assert all(p["ctl"] < 100 for p in fitness["points"])
    assert "comparaison seulement" in fitness["reference"]["note"]

    # l'export vers Claude signale aussi le repli
    export = world.client.get("/api/export?from=2026-10-01&to=2026-10-15").text
    assert "valeurs de repli Intervals.icu" in export
    assert "non disponible via Intervals.icu" in export

    # calendrier conservé brut, sans toucher au plan de l'appli
    assert world.count(RawPayload, RawPayload.type == "calendar") == 1
    assert world.count(PlannedSession) == 0

    # 3. Un nouveau run, toujours sans Garmin : idempotent
    before = world.count(Activity)
    world.run()
    assert world.count(Activity) == before

    # 4. Garmin revient : il comble la période manquante, sans doublon, Intervals redevient muet
    world.garmin.fail = None
    world.garmin.activities.append(garmin_act("g2", "2026-10-13T05:00:10+00:00", duration=3000))
    calls_before = len(world.icu.requests)
    report = world.run()
    assert [r.source for r in report.results] == ["garmin"] and report.results[0].ok
    assert len(world.icu.requests) == calls_before
    health = world.health()
    assert health["garmin"]["state"] == "ok" and health["garmin"]["badge"] is None
    acts = world.activities()
    assert len(acts) == 2 and {a["source"] for a in acts} == {"garmin"}  # g2 prévaut sur i2
    assert world.client.get("/api/metrics/recovery").json()["fallback"] is None


def test_fallback_window_starts_at_the_last_garmin_success(world: World) -> None:
    world.run()  # Garmin vide mais OK : last_success = maintenant
    world.garmin.fail = SourceError(STATE_DOWN, "Garmin injoignable.")
    world.run()
    params = [dict(r.url.params) for r in world.icu.requests if r.url.path.endswith("/activities")]
    # fenêtre = depuis la dernière réussite de Garmin (moins le recouvrement), pas 12 mois
    expected = {(datetime.now(UTC) - timedelta(days=d)).date().isoformat() for d in (3, 4)}
    assert params and params[0]["oldest"] in expected


def test_intervals_failure_during_fallback_is_never_blocking(world: World) -> None:
    world.garmin.fail = SourceError(STATE_DOWN, "Garmin injoignable.")
    world.icu.status = 500
    report = world.run()
    assert [r.ok for r in report.results] == [False, False]
    assert KEY not in json.dumps([r.error for r in report.results])
    assert world.client.get("/api/sources/health").status_code == 200
    assert world.client.get("/api/metrics/recovery").status_code == 200
    assert world.health()["intervals"]["state"] == "down"


def test_wrong_key_during_fallback_asks_for_the_configuration(world: World) -> None:
    world.garmin.fail = SourceError(STATE_DOWN, "Garmin injoignable.")
    world.icu.status = 401
    world.run()
    assert world.health()["intervals"]["state"] == "auth_required"
    assert "INTERVALS_API_KEY" in world.health()["intervals"]["message"]


def test_rebuild_from_raw_payloads_keeps_both_sources(world: World) -> None:
    from app.sync.service import rebuild_normalized

    world.garmin.fail = SourceError(STATE_DOWN, "Garmin injoignable.")
    world.icu.activities = [icu_activity("i1", "2026-10-10T05:00:00Z")]
    world.icu.wellness = [{"id": "2026-10-14", "hrv": 63.0, "ctl": 40.0}]
    world.run()
    with world.app.state.session_factory() as s:
        counts = rebuild_normalized(
            s, {"garmin": FAKE_NORMALIZER, "intervals": INTERVALS_NORMALIZER}
        )
        assert counts["skipped"] == 0
        row = s.scalars(select(WellnessDaily)).one()
        assert (row.source, row.hrv_nuit, row.source_ctl) == ("intervals", 63.0, 40.0)
    assert len(world.activities()) == 1


def test_fallback_not_configured_leaves_behavior_unchanged(tmp_path: Path) -> None:
    settings = Settings(database_path=str(tmp_path / "n.db"), scheduler_enabled=False)
    app = create_app(settings)
    garmin = FakeConnector("garmin")
    garmin.fail = SourceError(STATE_DOWN, "Garmin injoignable.")
    service = SyncService(
        app.state.session_factory,
        {"garmin": garmin},
        {"garmin": FAKE_NORMALIZER},
        fallbacks={"garmin": "intervals"},
    )
    with TestClient(app):
        report = service.run_all()
    assert [r.source for r in report.results] == ["garmin"] and not report.results[0].ok
