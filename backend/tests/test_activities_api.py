from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Activity, ActivityStream, WellnessDaily
from app.sync.dedup import assign_dedup_groups
from app.sync.streams import encode_stream

TODAY = date(2026, 10, 15)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "a.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def hill_stream() -> dict[str, list[float | None]]:
    """1200 s à 2,5 m/s : plat, montée de 100 m sur 1 km (10 %), plat ; FC 130 puis 170."""
    t: list[float | None] = [float(i) for i in range(1200)]
    altitude: list[float | None] = []
    for i in range(1200):
        if i < 400:
            altitude.append(100.0)
        elif i < 800:
            altitude.append(100.0 + 0.25 * (i - 400))
        else:
            altitude.append(200.0)
    return {
        "t": t,
        "fc": [130.0 if i < 600 else 170.0 for i in range(1200)],
        "altitude": altitude,
        "speed": [2.5] * 1200,
        "distance": [2.5 * i for i in range(1200)],
    }


def add(
    client: TestClient,
    ext: str,
    start: datetime,
    minutes: float = 60,
    sport: str = "trail_running",
    km: float | None = 10,
    gain: float | None = 400,
    hr_avg: int | None = 140,
    race: bool = False,
    source: str = "garmin",
    stream: dict[str, list[float | None]] | None = None,
) -> int:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        act = Activity(
            source=source,
            external_id=ext,
            sport=sport,
            start_utc=start,
            duration_s=minutes * 60,
            distance_m=km * 1000 if km else None,
            elevation_gain_m=gain,
            elevation_loss_m=gain,
            hr_avg=hr_avg,
            is_race=race,
        )
        s.add(act)
        s.flush()
        if stream is not None:
            s.add(ActivityStream(activity_id=act.id, samples=encode_stream(stream)))
        assign_dedup_groups(s)
        s.commit()
        return act.id


def test_list_is_empty_on_a_fresh_base(client: TestClient) -> None:
    assert client.get("/api/activities").json() == []


def test_list_order_fields_and_filters(client: TestClient) -> None:
    add(client, "a", datetime(2026, 10, 10, 6), 90, km=12, gain=600, sport="trail_running")
    add(client, "b", datetime(2026, 10, 12, 6), 50, km=8, gain=50, sport="running")
    add(
        client,
        "c",
        datetime(2026, 10, 13, 6),
        40,
        km=None,
        gain=None,
        sport="strength_training",
        hr_avg=None,
    )
    add(client, "d", datetime(2026, 10, 14, 6), 180, km=31, gain=1600, race=True)

    rows = client.get("/api/activities").json()
    assert [r["day"] for r in rows] == ["2026-10-14", "2026-10-13", "2026-10-12", "2026-10-10"]
    race, strength, road, trail = rows
    assert trail["duration_min"] == 90 and trail["distance_km"] == 12 and trail["dplus_m"] == 600
    assert trail["dplus_per_km"] == pytest.approx(50.0)
    assert trail["pace_s_per_km"] == pytest.approx(90 * 60 / 12)  # 7 min 30 s / km
    assert trail["gap_s_per_km"] is None  # pas encore calculée : jamais inventée
    assert trail["sport_group"] == "trail" and road["sport_group"] == "run"
    assert strength["sport_group"] == "other"
    assert strength["distance_km"] is None and strength["pace_s_per_km"] is None
    assert strength["dplus_per_km"] is None and strength["hr_avg"] is None
    assert race["is_race"] is True and race["rpe"] is None

    assert len(client.get("/api/activities", params={"limit": 2}).json()) == 2
    assert [
        r["sport_group"] for r in client.get("/api/activities", params={"group": "trail"}).json()
    ] == [
        "trail",
        "trail",
    ]
    assert len(client.get("/api/activities", params={"races_only": True}).json()) == 1
    window = client.get("/api/activities", params={"from": "2026-10-12", "to": "2026-10-13"}).json()
    assert [r["day"] for r in window] == ["2026-10-13", "2026-10-12"]


def test_list_validation(client: TestClient) -> None:
    assert client.get("/api/activities", params={"limit": 0}).status_code == 422
    assert client.get("/api/activities", params={"limit": 500}).status_code == 422
    assert client.get("/api/activities", params={"group": "velo"}).status_code == 422
    assert (
        client.get("/api/activities", params={"from": "2026-10-10", "to": "2026-10-01"}).status_code
        == 422
    )
    assert (
        client.get("/api/activities", params={"from": "2020-01-01", "to": "2026-10-01"}).status_code
        == 422
    )


def test_duplicates_across_sources_listed_once_with_rpe(client: TestClient) -> None:
    start = datetime(2026, 10, 14, 6)
    g = add(client, "g", start, 60, source="garmin")
    add(client, "i", start + timedelta(seconds=20), 61, source="intervals")
    client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": g, "rpe": 7}]})
    [row] = client.get("/api/activities").json()
    assert row["source"] == "garmin" and row["rpe"] == 7


def test_detail_unknown_activity(client: TestClient) -> None:
    assert client.get("/api/activities/999").status_code == 404


def test_detail_with_stream_zones_and_climbs(client: TestClient) -> None:
    aid = add(client, "hill", datetime(2026, 10, 14, 6), 20, km=3, gain=100, stream=hill_stream())
    r = client.get(f"/api/activities/{aid}")
    assert r.status_code == 200
    body = r.json()

    stream = body["stream"]
    assert stream["points_total"] == 1200
    n = len(stream["t"])
    assert 200 <= n <= 500  # réduit pour l'affichage
    assert all(len(stream[k]) == n for k in ("distance_km", "altitude_m", "hr", "pace_s_per_km"))
    assert stream["distance_km"][-1] == pytest.approx(2.9975, abs=0.01)
    assert stream["altitude_m"][0] == 100 and stream["altitude_m"][-1] == 200
    assert stream["pace_s_per_km"][0] == pytest.approx(400)  # 2,5 m/s = 6 min 40 s / km

    zones = body["zones"]
    assert zones["floors_bpm"] == [98, 117, 137, 156, 176]
    # 130 bpm = zone 2 (600 s) ; 170 bpm = zone 4 (600 s)
    assert zones["seconds"] == [0, 0, 600, 0, 600, 0]
    assert zones["hr_time_s"] == 1200 and zones["low_share_pct"] == pytest.approx(50.0)

    [climb] = body["climbs"]
    assert climb["gain_m"] == pytest.approx(100, abs=12)
    assert climb["length_m"] == pytest.approx(1000, abs=150)
    assert climb["avg_grade_pct"] == pytest.approx(10.0, abs=1.0)
    assert climb["start_km"] == pytest.approx(1.0, abs=0.15)
    assert climb["duration_s"] == pytest.approx(400, abs=60)
    assert climb["avg_hr"] is not None

    assert any("GAP" in note for note in body["notes"])
    assert body["gap_s_per_km"] is None
    assert body["evidence"]["level"] == "indicatif"


def test_detail_without_stream(client: TestClient) -> None:
    aid = add(client, "nostream", datetime(2026, 10, 14, 6))
    body = client.get(f"/api/activities/{aid}").json()
    assert body["stream"] is None and body["zones"] is None and body["climbs"] == []
    assert any("Pas de flux" in note for note in body["notes"])
    assert body["duration_min"] == 60  # les valeurs de la sortie restent disponibles


def test_detail_partial_streams_and_race_note(client: TestClient) -> None:
    only_time: dict[str, list[float | None]] = {"t": [0.0, 1.0, 2.0], "altitude": [1.0, 2.0, 3.0]}
    aid = add(client, "partial", datetime(2026, 10, 14, 6), stream=only_time, race=True)
    body = client.get(f"/api/activities/{aid}").json()
    assert body["zones"] is None and body["climbs"] == []
    assert body["stream"]["hr"] == [None, None, None]
    assert any("Pas de FC" in n for n in body["notes"])
    assert any("distance" in n for n in body["notes"])

    race_stream = hill_stream()
    rid = add(client, "race", datetime(2026, 10, 13, 6), race=True, stream=race_stream)
    notes = client.get(f"/api/activities/{rid}").json()["notes"]
    assert any("FC de compétition" in n for n in notes)


def test_distance_is_rebuilt_from_speed_when_missing(client: TestClient) -> None:
    s = hill_stream()
    del s["distance"]
    aid = add(client, "nodist", datetime(2026, 10, 14, 6), stream=s)
    body = client.get(f"/api/activities/{aid}").json()
    assert body["stream"]["distance_km"][-1] == pytest.approx(2.9, abs=0.1)
    assert len(body["climbs"]) == 1


def seed_wellness(client: TestClient) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        for offset in (0, 1, 3, 100):  # jours manquants : 2 jours d'écart, puis très ancien
            s.add(
                WellnessDaily(
                    date=TODAY - timedelta(days=offset),
                    source="garmin",
                    hrv_nuit=60.0 + offset,
                    hrv_base_min=54,
                    hrv_base_max=71,
                    fc_repos=48,
                    sommeil_duree_s=27000,
                    sommeil_efficacite=90.0,
                    training_readiness=70,
                    body_battery_max=90,
                    body_battery_min=15,
                )
            )
        s.add(WellnessDaily(date=TODAY, source="intervals", hrv_nuit=99.0, fc_repos=44))
        s.commit()


def test_wellness_series_only_returns_days_with_data(client: TestClient) -> None:
    seed_wellness(client)
    body = client.get("/api/metrics/wellness", params={"days": 30}).json()
    assert body["end"] == "2026-10-15" and body["start"] == "2026-09-16"
    assert [p["date"] for p in body["points"]] == ["2026-10-12", "2026-10-14", "2026-10-15"]
    today = body["points"][-1]
    assert today["hrv_nuit"] == 60  # Garmin prioritaire sur Intervals.icu
    assert today["fc_repos"] == 48
    assert today["sommeil_duree_h"] == pytest.approx(7.5)
    assert today["hrv_base_min"] == 54 and today["hrv_base_max"] == 71
    assert body["evidence"]["level"] == "avis_montre"
    assert len(client.get("/api/metrics/wellness", params={"days": 60}).json()["points"]) == 3
    assert len(client.get("/api/metrics/wellness", params={"days": 365}).json()["points"]) == 4


def test_wellness_series_empty_and_validation(client: TestClient) -> None:
    assert client.get("/api/metrics/wellness").json()["points"] == []
    assert client.get("/api/metrics/wellness", params={"days": 3}).status_code == 422
    assert client.get("/api/metrics/wellness", params={"days": 400}).status_code == 422
