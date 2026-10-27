import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db import make_engine, make_session_factory
from app.main import run_migrations
from app.models import Activity, ActivityStream, RawPayload, SourceStatus, WellnessDaily
from app.sync.dedup import primary_activities
from app.sync.service import SyncBusyError, SyncService, rebuild_normalized
from app.sync.streams import decode_stream
from tests.fake_connector import (
    FAKE_NORMALIZER,
    FakeConnector,
    activity_payload,
    stream_payload,
    wellness_payload,
)


@pytest.fixture
def factory(tmp_path: Path) -> Iterator[sessionmaker[Session]]:
    url = f"sqlite:///{tmp_path / 'sync.db'}"
    run_migrations(url)
    engine = make_engine(url)
    yield make_session_factory(engine)
    engine.dispose()


def make_service(factory: sessionmaker[Session], *connectors: FakeConnector) -> SyncService:
    return SyncService(
        factory,
        {c.name: c for c in connectors},
        {c.name: FAKE_NORMALIZER for c in connectors},
        priority=["garmin", "intervals", "strava"],
    )


def count(factory: sessionmaker[Session], model: type) -> int:
    with factory() as s:
        return s.scalar(select(func.count()).select_from(model)) or 0


def garmin() -> FakeConnector:
    return FakeConnector(
        "garmin",
        activities=[
            activity_payload("a1"),
            activity_payload("a2", start="2026-10-02T06:00:00+00:00"),
        ],
        wellness=[wellness_payload("2026-10-01"), wellness_payload("2026-10-02", 58)],
        streams={"a1": stream_payload()},
    )


def test_sync_writes_raw_and_normalized(factory: sessionmaker[Session]) -> None:
    report = make_service(factory, garmin()).run_all()
    assert report.results[0].ok
    assert report.results[0].inserted == 4
    assert count(factory, RawPayload) == 6  # 2 activités + 2 bien-être + 2 flux (1 vide)
    assert count(factory, Activity) == 2
    assert count(factory, WellnessDaily) == 2
    assert count(factory, ActivityStream) == 1
    with factory() as s:
        act = s.scalars(select(Activity).where(Activity.external_id == "a1")).one()
        assert act.start_utc.isoformat() == "2026-10-01T06:00:00"
        stream = s.get(ActivityStream, act.id)
        assert stream is not None
        assert decode_stream(stream.samples)["fc"] == [120, 121, 122, 123, 124]
        status = s.get(SourceStatus, "garmin")
        assert status is not None
        assert status.last_success_at is not None
        assert status.unavailable_since is None


def test_two_identical_syncs_create_no_duplicates(factory: sessionmaker[Session]) -> None:
    connector = garmin()
    service = make_service(factory, connector)
    service.run_all()
    stream_calls = connector.calls["streams"]
    before = [count(factory, m) for m in (RawPayload, Activity, WellnessDaily, ActivityStream)]
    report = service.run_all()
    after = [count(factory, m) for m in (RawPayload, Activity, WellnessDaily, ActivityStream)]
    assert before == after
    assert report.results[0].inserted == 0
    assert report.results[0].unchanged == 4
    assert connector.calls["streams"] == stream_calls  # rien de modifié : pas de nouvel appel


def test_changed_payload_is_updated_in_place(factory: sessionmaker[Session]) -> None:
    connector = garmin()
    service = make_service(factory, connector)
    service.run_all()
    connector.activities[0] = activity_payload("a1", duration=3700)
    report = service.run_all()
    assert report.results[0].updated == 1
    assert count(factory, Activity) == 2
    with factory() as s:
        act = s.scalars(select(Activity).where(Activity.external_id == "a1")).one()
        assert act.duration_s == 3700


def test_rebuild_from_raw_without_calling_api(factory: sessionmaker[Session]) -> None:
    connector = garmin()
    service = make_service(factory, connector)
    service.run_all()
    calls = dict(connector.calls)
    with factory() as s:
        snapshot = sorted(
            (a.external_id, a.start_utc, a.duration_s, a.dedup_group_id is not None)
            for a in s.scalars(select(Activity))
        )
        s.query(Activity).delete()  # corruption des tables normalisées
        s.query(WellnessDaily).delete()
        s.commit()
    with factory() as s:
        counts = rebuild_normalized(s, service.normalizers)
    assert counts == {"activities": 2, "streams": 2, "wellness": 2, "skipped": 0}
    assert connector.calls == calls
    with factory() as s:
        rebuilt = sorted(
            (a.external_id, a.start_utc, a.duration_s, a.dedup_group_id is not None)
            for a in s.scalars(select(Activity))
        )
    assert rebuilt == snapshot
    assert count(factory, WellnessDaily) == 2
    assert count(factory, ActivityStream) == 1
    assert count(factory, RawPayload) == 6


def test_source_failure_keeps_data_and_flags_unavailable(
    factory: sessionmaker[Session],
) -> None:
    connector = garmin()
    other = FakeConnector(
        "intervals", activities=[activity_payload("i1", "2026-10-05T07:00:00+00:00")]
    )
    service = make_service(factory, connector, other)
    service.run_all()
    n_raw, n_act = count(factory, RawPayload), count(factory, Activity)

    connector.fail = RuntimeError("401 token=abc123SECRET expiré")
    report = service.run_all()
    by_source = {r.source: r for r in report.results}
    assert not by_source["garmin"].ok
    assert "abc123SECRET" not in (by_source["garmin"].error or "")
    assert by_source["intervals"].ok  # l'autre source continue
    assert count(factory, RawPayload) == n_raw
    assert count(factory, Activity) == n_act

    with factory() as s:
        st = s.get(SourceStatus, "garmin")
        assert st is not None
        first_since = st.unavailable_since
        assert first_since is not None
        assert st.last_success_at is not None  # dernière réussite conservée
        assert "abc123SECRET" not in (st.last_error_message or "")

    service.run_all()  # second échec : "depuis quand" ne bouge pas
    with factory() as s:
        st = s.get(SourceStatus, "garmin")
        assert st is not None and st.unavailable_since == first_since

    connector.fail = None
    service.run_all()
    with factory() as s:
        st = s.get(SourceStatus, "garmin")
        assert st is not None and st.unavailable_since is None


def test_stream_failure_is_only_a_warning(factory: sessionmaker[Session]) -> None:
    connector = garmin()

    def boom(_id: str) -> None:
        raise RuntimeError("flux indisponible")

    connector.fetch_activity_stream = boom  # type: ignore[method-assign,assignment]
    report = make_service(factory, connector).run_all()
    assert report.results[0].ok
    assert report.results[0].warnings
    assert count(factory, Activity) == 2


def test_concurrent_sync_is_locked(factory: sessionmaker[Session]) -> None:
    connector = garmin()
    connector.gate = threading.Event()
    service = make_service(factory, connector)
    assert service.start_async()
    assert service.running
    assert not service.start_async()  # deuxième demande refusée
    with pytest.raises(SyncBusyError):
        service.run_all()
    connector.gate.set()
    service.wait(5)
    assert not service.running
    assert service.last_report is not None
    assert service.start_async()  # le verrou est bien relâché
    service.wait(5)


def test_dedup_across_sources(factory: sessionmaker[Session]) -> None:
    g = FakeConnector(
        "garmin", activities=[activity_payload("g1", "2026-10-01T06:00:00+00:00", 3600)]
    )
    i = FakeConnector(
        "intervals",
        activities=[
            activity_payload("i1", "2026-10-01T06:00:45+00:00", 3650),  # ±60 s, ±5 % : doublon
            activity_payload("i2", "2026-10-01T06:02:00+00:00", 3600),  # début trop éloigné
            activity_payload("i3", "2026-10-03T06:00:00+00:00", 3600),  # autre jour
        ],
    )
    service = make_service(factory, g, i)
    service.run_all()
    service.run_all()
    with factory() as s:
        acts = {a.external_id: a for a in s.scalars(select(Activity))}
        assert acts["g1"].dedup_group_id == acts["i1"].dedup_group_id
        assert acts["i2"].dedup_group_id != acts["g1"].dedup_group_id
        assert acts["i3"].dedup_group_id != acts["g1"].dedup_group_id
        primary = {a.external_id for a in primary_activities(s, ["garmin", "intervals"])}
        assert primary == {"g1", "i2", "i3"}  # Garmin prioritaire sur Intervals
        primary = {a.external_id for a in primary_activities(s, ["intervals", "garmin"])}
        assert primary == {"i1", "i2", "i3"}  # ordre configurable


def test_dedup_requires_similar_duration(factory: sessionmaker[Session]) -> None:
    g = FakeConnector("garmin", activities=[activity_payload("g1", duration=3600)])
    i = FakeConnector("intervals", activities=[activity_payload("i1", duration=4000)])  # +11 %
    make_service(factory, g, i).run_all()
    with factory() as s:
        acts = list(s.scalars(select(Activity)))
        assert len({a.dedup_group_id for a in acts}) == 2


def test_same_source_activities_never_merged(factory: sessionmaker[Session]) -> None:
    g = FakeConnector(
        "garmin",
        activities=[activity_payload("g1"), activity_payload("g2", "2026-10-01T06:00:10+00:00")],
    )
    make_service(factory, g).run_all()
    with factory() as s:
        assert len({a.dedup_group_id for a in s.scalars(select(Activity))}) == 2


def test_sync_never_clears_a_manual_race_flag(factory: sessionmaker[Session]) -> None:
    connector = garmin()
    service = make_service(factory, connector)
    service.run_all()
    with factory() as s:
        act = s.scalars(select(Activity).where(Activity.external_id == "a1")).one()
        assert act.is_race is False
        act.is_race = True
        s.commit()
    connector.activities[0] = activity_payload("a1", duration=3700)  # force la mise à jour
    service.run_all()
    with factory() as s:
        act = s.scalars(select(Activity).where(Activity.external_id == "a1")).one()
        assert act.duration_s == 3700 and act.is_race is True
