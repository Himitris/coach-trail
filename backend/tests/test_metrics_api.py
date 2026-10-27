import math
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.metrics.srpe import SRPEEntry
from app.models import Activity, ActivityStream, RawPayload, WellnessDaily
from app.sync.dedup import assign_dedup_groups
from app.sync.streams import encode_stream

TODAY = date(2026, 10, 15)  # jeudi


class FakeReader:
    def read_srpe(self, start: date, end: date) -> list[SRPEEntry]:
        return [SRPEEntry(date(2026, 10, 12), 6, 60), SRPEEntry(date(2026, 10, 14), 4, 30)]


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "m.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def add_activity(
    client: TestClient,
    ext: str,
    start: datetime,
    seconds: int,
    hr: float | None,
    race: bool = False,
    km: float = 10,
    gain: float = 400,
    source: str = "garmin",
) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        act = Activity(
            source=source,
            external_id=ext,
            sport="trail_running",
            start_utc=start,
            duration_s=seconds,
            distance_m=km * 1000,
            elevation_gain_m=gain,
            elevation_loss_m=gain,
            hr_avg=int(hr) if hr else None,
            is_race=race,
        )
        s.add(act)
        s.flush()
        if hr is not None:
            samples: dict[str, list[float | None]] = {
                "t": [float(i) for i in range(seconds)],
                "fc": [hr] * seconds,
            }
            s.add(ActivityStream(activity_id=act.id, samples=encode_stream(samples)))
        assign_dedup_groups(s)
        s.commit()


@pytest.fixture
def trained(client: TestClient) -> TestClient:
    client.put("/api/profile", json={"fc_repos": 50, "seuil_lactique_fc": 170})
    # course du samedi 10 : 1 h 30 à 185 bpm ; lundi 12 : 1 h à 130 ; mercredi 14 : 30 min à 170
    add_activity(client, "race", datetime(2026, 10, 10, 6), 5400, 185, race=True, km=31, gain=1600)
    add_activity(client, "a", datetime(2026, 10, 12, 6), 3600, 130)
    add_activity(client, "b", datetime(2026, 10, 14, 6), 1800, 170, km=5, gain=100)
    return client


def test_week_endpoint(trained: TestClient) -> None:
    client = trained
    r = client.get("/api/metrics/week", params={"date": "2026-10-05"})
    assert r.status_code == 200
    body = r.json()
    assert body["week_start"] == "2026-10-05" and body["complete"] is True
    assert body["current"]["time_s"] == 5400  # la course compte dans le volume
    assert body["current"]["gain_m"] == 1600
    assert body["previous"]["sessions"] == 0 and body["time_change_vs_previous_pct"] is None
    assert body["srpe"] is None  # aucun lecteur de saisies branché

    body = client.get("/api/metrics/week").json()  # semaine en cours par défaut
    assert body["week_start"] == "2026-10-12" and body["complete"] is False
    assert body["current"]["time_s"] == 5400 and body["current"]["sessions"] == 2
    assert body["time_change_vs_previous_pct"] == pytest.approx(0.0)
    assert body["exceeds_reference"] is None
    assert body["evidence"]["level"] == "etabli"


def test_week_srpe_through_reader(trained: TestClient) -> None:
    trained.app.state.entry_reader = FakeReader()  # type: ignore[attr-defined]
    body = trained.get("/api/metrics/week").json()
    assert body["srpe"]["total_load_au"] == 6 * 60 + 4 * 30
    assert body["srpe"]["entries"] == 2


def test_intensity_endpoint_excludes_race(trained: TestClient) -> None:
    r = trained.get("/api/metrics/intensity", params={"weeks": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["zone_floors_bpm"] == [98, 117, 137, 156, 176]
    prev, cur = body["weeks"]
    assert prev["races_excluded"] == 1 and prev["low_share_pct"] is None
    # 130 bpm = zone 2 (3600 s, bas) ; 170 bpm = zone 4 (1800 s) -> 3600 / 5400
    assert cur["zone_seconds"] == [0, 0, 3600, 0, 1800, 0]
    assert cur["low_share_pct"] == pytest.approx(66.6667, abs=1e-3)
    assert cur["delta_to_target_pct"] == pytest.approx(-8.3333, abs=1e-3)
    assert cur["activities_counted"] == 2
    assert body["target_min_pct"] == 75 and body["target_max_pct"] == 80


def test_fitness_endpoint_hand_computed(trained: TestClient) -> None:
    r = trained.get("/api/metrics/fitness", params={"from": "2026-10-10", "to": "2026-10-14"})
    assert r.status_code == 200
    body = r.json()
    pts = {p["date"]: p for p in body["points"]}
    # ratio = (FC - repos) / (seuil - repos) ; charge = heures × ratio² × 100
    race = 1.5 * (135 / 120) ** 2 * 100  # 189,84375
    a = 1.0 * (80 / 120) ** 2 * 100  # 44,444
    b = 0.5 * (120 / 120) ** 2 * 100  # 50
    assert pts["2026-10-10"]["load"] == pytest.approx(race)
    assert pts["2026-10-12"]["load"] == pytest.approx(a)
    assert pts["2026-10-14"]["load"] == pytest.approx(b)
    assert pts["2026-10-11"]["load"] == 0
    k = 1 - math.exp(-1 / 42)
    ctl_end = k * (race * math.exp(-4 / 42) + a * math.exp(-2 / 42) + b)
    assert pts["2026-10-14"]["ctl"] == pytest.approx(ctl_end)
    k7 = 1 - math.exp(-1 / 7)
    atl_end = k7 * (race * math.exp(-4 / 7) + a * math.exp(-2 / 7) + b)
    assert pts["2026-10-14"]["atl"] == pytest.approx(atl_end)
    assert pts["2026-10-14"]["tsb"] == pytest.approx(ctl_end - atl_end)
    assert body["ctl_ramp_4w"] is None
    assert any("sous-estimé" in w for w in body["warnings"])
    assert body["evidence"]["level"] == "indicatif"


def test_fitness_defaults_and_validation(trained: TestClient) -> None:
    body = trained.get("/api/metrics/fitness").json()
    assert body["end"] == "2026-10-15" and body["start"] == "2026-07-17"
    assert body["points"][0]["date"] == "2026-07-17" and body["points"][0]["ctl"] == 0
    r = trained.get("/api/metrics/fitness", params={"from": "2026-10-10", "to": "2026-10-01"})
    assert r.status_code == 422
    r = trained.get("/api/metrics/fitness", params={"from": "2020-01-01", "to": "2026-10-01"})
    assert r.status_code == 422


def test_fitness_notes_on_profile_and_missing_hr(client: TestClient) -> None:
    add_activity(client, "x", datetime(2026, 10, 12, 6), 3600, None)  # sans FC ni flux
    add_activity(client, "y", datetime(2026, 10, 13, 6), 3600, None)
    body = client.get("/api/metrics/fitness").json()
    joined = " ".join(body["warnings"])
    assert "FC repos absente" in joined and "Seuil lactique absent" in joined
    assert "sans donnée de FC" in joined
    assert body["points"] == [] or all(p["load"] == 0 for p in body["points"])


def test_fitness_estimates_from_average_without_stream(client: TestClient) -> None:
    client.put("/api/profile", json={"fc_repos": 50, "seuil_lactique_fc": 170})
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.add(
            Activity(
                source="garmin",
                external_id="nostream",
                sport="running",
                start_utc=datetime(2026, 10, 12, 6),
                duration_s=3600,
                hr_avg=170,
                dedup_group_id=None,
            )
        )
        s.commit()
    body = client.get(
        "/api/metrics/fitness", params={"from": "2026-10-12", "to": "2026-10-12"}
    ).json()
    assert body["points"][0]["load"] == pytest.approx(100.0)  # 1 h au seuil
    assert any("FC moyenne" in w for w in body["warnings"])


def test_deduplicated_activity_counted_once(client: TestClient) -> None:
    start = datetime(2026, 10, 12, 6)
    add_activity(client, "g1", start, 3600, 130, source="garmin")
    add_activity(client, "i1", start + timedelta(seconds=20), 3620, 130, source="intervals")
    body = client.get("/api/metrics/week").json()
    assert body["current"]["sessions"] == 1 and body["current"]["time_s"] == 3600  # Garmin


def seed_wellness(client: TestClient, with_acwr: bool = False) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        for i in range(75):
            day = TODAY - timedelta(days=i)
            recent = i < 7
            hrv = 64.0 if recent else (58.0 if i % 2 == 0 else 62.0)
            s.add(
                WellnessDaily(
                    date=day,
                    source="garmin",
                    hrv_nuit=hrv,
                    hrv_base_min=54,
                    hrv_base_max=71,
                    fc_repos=47 if recent else 50,
                    sommeil_duree_s=27000,
                    sommeil_efficacite=90.0,
                    training_readiness=70 + (4 if i == 0 else 0),
                    body_battery_max=90,
                    body_battery_min=15,
                )
            )
        if with_acwr:
            ratio = {"x": {"acuteTrainingLoadDTO": {"dailyAcuteChronicWorkloadRatio": 1.3}}}
            s.add(
                RawPayload(
                    source="garmin",
                    type="wellness",
                    external_key=TODAY.isoformat(),
                    fetched_at=datetime.now(UTC).replace(tzinfo=None),
                    payload={"date": TODAY.isoformat(), "training_status": ratio},
                    hash="h",
                )
            )
        s.commit()


def test_recovery_endpoint(client: TestClient) -> None:
    seed_wellness(client)
    r = client.get("/api/metrics/recovery")
    assert r.status_code == 200
    body: dict[str, Any] = r.json()
    hrv = body["hrv"]
    assert hrv["recent_mean"] == 64 and hrv["baseline_days"] == 60
    assert hrv["delta_pct"] == pytest.approx(4 / 60 * 100)
    assert hrv["delta_sd"] == pytest.approx(4 / math.sqrt(240 / 59), rel=1e-3)
    assert hrv["trend"]["direction"] == "hausse" and hrv["sufficient"] is True
    assert body["resting_hr"]["trend"]["direction"] == "baisse"  # 47 vs 50
    assert body["sleep_duration_h"]["recent_mean"] == pytest.approx(7.5)
    assert body["sleep_efficiency_pct"]["recent_mean"] == 90
    tr = body["training_readiness"]
    assert tr["value"] == 74 and tr["label"] == "avis Garmin, non validé"
    assert tr["evidence"]["level"] == "avis_montre"
    assert body["body_battery_max"]["value"] == 90 and body["body_battery_min"]["value"] == 15
    assert body["garmin_hrv_reference"]["min"] == 54 and body["garmin_hrv_reference"]["max"] == 71
    assert body["acwr"] is None  # jamais calculé ici
    # pas de score unique ni de code couleur
    assert not {"score", "color", "status", "alert"} & set(body)


def test_recovery_acwr_is_garmin_value_marked_not_validated(client: TestClient) -> None:
    seed_wellness(client, with_acwr=True)
    acwr = client.get("/api/metrics/recovery", params={"days": 30}).json()["acwr"]
    assert acwr["value"] == 1.3 and acwr["label"] == "non validé"
    assert acwr["evidence"]["level"] == "non_valide"


def test_recovery_without_data_and_validation(client: TestClient) -> None:
    body = client.get("/api/metrics/recovery").json()
    assert body["hrv"]["recent_mean"] is None and body["hrv"]["sufficient"] is False
    assert body["training_readiness"]["value"] is None
    assert body["garmin_hrv_reference"] is None and body["acwr"] is None
    assert client.get("/api/metrics/recovery", params={"days": 10}).status_code == 422
    assert client.get("/api/metrics/recovery", params={"days": 90}).status_code == 422


def test_other_validation(client: TestClient) -> None:
    assert client.get("/api/metrics/intensity", params={"weeks": 0}).status_code == 422
    assert client.get("/api/metrics/intensity", params={"weeks": 53}).status_code == 422
    assert client.get("/api/metrics/week", params={"date": "pas-une-date"}).status_code == 422
    empty = client.get("/api/metrics/week").json()  # base vide : semaine vide, pas d'erreur
    assert empty["current"]["sessions"] == 0 and empty["trend"]["direction"] == "indetermine"
    assert client.get("/api/metrics/intensity").status_code == 200
    assert client.get("/api/metrics/fitness").json()["points"] == []
