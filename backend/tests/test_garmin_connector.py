import random
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import make_engine, make_session_factory
from app.garmin.auth import build_api
from app.garmin.connector import GarminConnector
from app.garmin.normalize import GARMIN_NORMALIZER
from app.main import run_migrations
from app.models import (
    Activity,
    ActivityStream,
    AthleteProfile,
    RawPayload,
    SourceStatus,
    WellnessDaily,
)
from app.sync.service import SyncService
from app.sync.types import SourceError
from tests.fake_garmin import FakeGarminAPI, FakeHTTPError

TODAY = date(2026, 10, 6)


@pytest.fixture
def factory(tmp_path: Path) -> Iterator[sessionmaker[Session]]:
    url = f"sqlite:///{tmp_path / 'g.db'}"
    run_migrations(url)
    engine = make_engine(url)
    yield make_session_factory(engine)
    engine.dispose()


def setup(
    factory: sessionmaker[Session], api: FakeGarminAPI | None = None
) -> tuple[SyncService, FakeGarminAPI, list[float]]:
    api = api or FakeGarminAPI()
    sleeps: list[float] = []
    connector = GarminConnector(
        lambda: api,
        history_months=1,
        min_delay_s=1.0,
        max_delay_s=2.0,
        sleep=sleeps.append,
        rng=random.Random(1),  # noqa: S311
        today=lambda: TODAY,
    )
    service = SyncService(factory, {"garmin": connector}, {"garmin": GARMIN_NORMALIZER})
    return service, api, sleeps


def n(factory: sessionmaker[Session], model: type) -> int:
    with factory() as s:
        return s.scalar(select(func.count()).select_from(model)) or 0


def status(factory: sessionmaker[Session]) -> SourceStatus:
    with factory() as s:
        st = s.get(SourceStatus, "garmin")
        assert st is not None
        s.expunge(st)
        return st


def test_full_sync_on_fixtures(factory: sessionmaker[Session]) -> None:
    service, api, sleeps = setup(factory)
    report = service.run_all()
    res = report.results[0]
    assert res.ok, res.error
    assert n(factory, Activity) == 1
    assert n(factory, ActivityStream) == 1
    # 1 mois d'historique : 30/31 jours jusqu'à aujourd'hui inclus
    assert n(factory, WellnessDaily) == len(api.called("get_sleep_data"))
    assert n(factory, WellnessDaily) >= 30
    with factory() as s:
        profile = s.get(AthleteProfile, 1)
        assert profile is not None
        assert profile.fc_max == 195  # jamais écrasé par Garmin
        assert profile.fc_repos == 47
        assert profile.seuil_lactique_fc == 173
        assert [z["min_bpm"] for z in profile.zones] == [100, 120, 139, 158, 177]
    st = status(factory)
    assert st.state == "ok" and st.unavailable_since is None
    # pauses aléatoires entre les appels, dans les bornes
    assert sleeps and all(1.0 <= x <= 2.0 for x in sleeps)
    assert len(set(sleeps)) > 1
    # statut d'entraînement et prédictions seulement pour le jour courant
    assert len(api.called("get_training_status")) == 1
    assert len(api.called("get_race_predictions")) == 1


def test_stream_requested_at_full_resolution_without_gps(
    factory: sessionmaker[Session],
) -> None:
    service, api, _ = setup(factory)
    service.run_all()
    [(act_id, maxchart, maxpoly)] = api.called("get_activity_details")
    assert (act_id, maxchart, maxpoly) == ("17000000001", 20000, 0)


def test_second_sync_is_idempotent_and_incremental(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    service.run_all()
    before = [n(factory, m) for m in (RawPayload, Activity, WellnessDaily, ActivityStream)]
    api.calls.clear()
    service.run_all()
    after = [n(factory, m) for m in (RawPayload, Activity, WellnessDaily, ActivityStream)]
    assert before == after
    # incrémental : l'historique complet n'est pas redemandé (recouvrement de 3 jours)
    assert len(api.called("get_sleep_data")) <= 5
    assert api.called("get_activity_details") == []  # flux déjà connu


def test_missing_tokens_means_auth_required_without_network(
    factory: sessionmaker[Session], tmp_path: Path
) -> None:
    with pytest.raises(SourceError) as err:
        build_api(tmp_path / "vide")
    assert err.value.state == "auth_required"


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (GarminConnectAuthenticationError("expired"), "auth_required"),
        (GarminConnectTooManyRequestsError("slow down"), "auth_required"),
        (FakeHTTPError(403), "auth_required"),
        (FakeHTTPError(429), "auth_required"),
        (GarminConnectConnectionError("timeout"), "down"),
        (OSError("réseau"), "down"),
    ],
)
def test_auth_and_network_errors_are_classified_without_crash(
    factory: sessionmaker[Session], error: Exception, expected: str
) -> None:
    service, api, _ = setup(factory)
    service.run_all()  # données initiales
    kept = [n(factory, m) for m in (RawPayload, Activity, WellnessDaily)]

    api.raises["get_activities_by_date"] = error
    report = service.run_all()
    assert not report.results[0].ok
    st = status(factory)
    assert st.state == expected
    assert st.message and st.unavailable_since is not None
    assert st.last_success_at is not None  # dernières valeurs et date de réussite conservées
    assert [n(factory, m) for m in (RawPayload, Activity, WellnessDaily)] == kept


def test_auth_failure_at_login_is_auth_required(factory: sessionmaker[Session]) -> None:
    def broken() -> FakeGarminAPI:
        raise GarminConnectAuthenticationError("Username and password are required")

    connector = GarminConnector(broken, sleep=lambda _s: None)
    service = SyncService(factory, {"garmin": connector}, {"garmin": GARMIN_NORMALIZER})
    report = service.run_all()
    assert not report.results[0].ok
    st = status(factory)
    assert st.state == "auth_required"
    assert "reconnexion" in (st.message or "")


def test_one_failing_endpoint_degrades_but_keeps_going(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    api.raises["get_hrv_data"] = GarminConnectConnectionError("500 sur HRV")
    report = service.run_all()
    assert report.results[0].ok
    assert len(report.results[0].warnings) <= 21  # avertissements plafonnés
    assert status(factory).state == "degraded"
    assert n(factory, WellnessDaily) >= 30  # le reste des données est bien là
    with factory() as s:
        w = s.scalars(select(WellnessDaily).order_by(WellnessDaily.date)).first()
        assert w is not None and w.hrv_nuit == 61.0 and w.hrv_base_min is None


def test_repeated_failures_everywhere_mean_down(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    for name in ("get_user_summary", "get_sleep_data", "get_hrv_data"):
        api.raises[name] = GarminConnectConnectionError("500")
    assert not service.run_all().results[0].ok
    st = status(factory)
    assert st.state == "down"
    assert "répétés" in (st.message or "")


def test_isolated_failures_give_degraded(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    original = api.get_training_readiness
    calls = {"i": 0}

    def flaky(cdate: str) -> Any:
        calls["i"] += 1
        if calls["i"] % 5 == 0:  # jamais 3 échecs consécutifs
            raise GarminConnectConnectionError("500")
        return original(cdate)

    api.get_training_readiness = flaky  # type: ignore[method-assign]
    report = service.run_all()
    assert report.results[0].ok
    st = status(factory)
    assert st.state == "degraded"
    assert "partielle" in (st.message or "")
    assert n(factory, WellnessDaily) >= 30


def test_stream_not_found_is_marked_and_not_retried(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    api.raises["get_activity_details"] = GarminConnectNotFoundError("404")
    assert service.run_all().results[0].ok
    assert n(factory, ActivityStream) == 0
    api.calls.clear()
    service.run_all()
    assert api.called("get_activity_details") == []


def test_stream_failure_is_retried_next_time(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    api.raises["get_activity_details"] = GarminConnectConnectionError("500")
    report = service.run_all()
    assert report.results[0].ok and report.results[0].warnings
    assert n(factory, ActivityStream) == 0
    api.raises.clear()
    service.run_all()
    assert n(factory, ActivityStream) == 1


def test_initial_history_window(factory: sessionmaker[Session]) -> None:
    service, api, _ = setup(factory)
    service.run_all()
    [(start, end, order)] = api.called("get_activities_by_date")
    assert (end, order) == ("2026-10-06", "asc")
    assert start == "2026-09-06"  # 1 mois d'historique configuré


def test_partial_failure_resumes_from_last_received_data(
    factory: sessionmaker[Session],
) -> None:
    service, api, _ = setup(factory)
    original = api.get_user_summary
    calls = {"i": 0}

    def dies(cdate: str) -> Any:
        calls["i"] += 1
        if calls["i"] > 28:
            raise GarminConnectTooManyRequestsError("429")
        return original(cdate)

    api.get_user_summary = dies  # type: ignore[method-assign]
    assert not service.run_all().results[0].ok
    partial = n(factory, RawPayload)
    assert partial > 0  # les lots reçus avant la panne sont conservés
    api.get_user_summary = original  # type: ignore[method-assign]
    api.calls.clear()
    service.run_all()
    first_day_requested = api.called("get_user_summary")[0][0]
    assert first_day_requested > "2026-09-06"  # reprise après les jours déjà reçus
