"""Endpoints de phase 2 : monotonie, fatigue, renforcement, objectif, nutrition."""

from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import EveningEntry, RawPayload
from tests.test_activities_api import add

TODAY = date(2026, 10, 15)  # jeudi


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "p2.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def at(day: date, hour: int = 6) -> datetime:
    return datetime(day.year, day.month, day.day, hour)


def put_entry(client: TestClient, day: date, courbatures: int) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.add(EveningEntry(kind="day", date=day, courbatures=courbatures, updated_at=at(day)))
        s.commit()


# --- monotonie ----------------------------------------------------------------------------------


def test_monotony_endpoint_weekly_series(client: TestClient) -> None:
    for offset in (0, 2, 4):  # lundi, mercredi, vendredi de la semaine en cours
        add(client, f"m{offset}", at(date(2026, 10, 12) + timedelta(days=offset)), 60, hr_avg=150)
    body = client.get("/api/metrics/monotony?weeks=3").json()
    assert body["reference"] == 2.0
    assert [w["week_start"] for w in body["weeks"]] == ["2026-09-28", "2026-10-05", "2026-10-12"]
    assert body["weeks"][0]["monotony"] is None  # avant la première donnée
    current = body["weeks"][2]
    assert current["complete"] is False and current["load"] > 0
    # 3 jours identiques sur 7 : écart-type > 0, monotonie finie, bien en dessous de 2
    assert 0 < current["monotony"] < 2 and current["strain"] == pytest.approx(
        current["load"] * current["monotony"]
    )
    assert current["soft_alert"] is False
    assert "jamais un prédicteur de blessure" in body["evidence"]["summary"]
    assert client.get("/api/metrics/monotony?weeks=1").status_code == 422


# --- fatigue ------------------------------------------------------------------------------------


def test_fatigue_endpoint_links_strong_descents_to_soreness_at_48h(client: TestClient) -> None:
    big = add(client, "big", at(date(2026, 10, 13)), 180, km=28, gain=1500)
    add(client, "small", at(date(2026, 10, 11)), 60, km=10, gain=100)
    put_entry(client, date(2026, 10, 15), 6)  # J+2 de la grosse sortie
    body = client.get("/api/metrics/fatigue?weeks=2").json()
    # le 11/10 (dimanche) ferme la semaine du 05/10 ; le 13/10 ouvre celle du 12/10
    assert [w["loss_m"] for w in body["weeks"]] == [100, 1500]
    strong = body["strong_sessions"]
    assert len(strong) == 1 and strong[0]["activity_id"] == big
    assert strong[0]["soreness_date"] == "2026-10-15" and strong[0]["soreness"] == 6
    assert body["suggestion"]["easy_from"] == "2026-10-14"
    assert "Information, pas une prescription" in body["suggestion"]["message"]


def test_fatigue_without_entry_reports_none(client: TestClient) -> None:
    add(client, "big", at(date(2026, 10, 1)), 180, km=28, gain=1500)
    body = client.get("/api/metrics/fatigue?weeks=3").json()
    assert body["strong_sessions"][0]["soreness"] is None and body["suggestion"] is None


# --- renforcement -------------------------------------------------------------------------------


def test_strength_target_detected_and_manual_sessions(client: TestClient) -> None:
    assert client.get("/api/metrics/strength?weeks=2").json()["target"] is None
    assert (
        client.put("/api/profile", json={"renfo_objectif_hebdo": 2}).json()["renfo_objectif_hebdo"]
        == 2
    )
    add(client, "s1", at(date(2026, 10, 13)), 30, sport="strength_training", km=None, gain=None)
    made = client.post("/api/strength/sessions", json={"date": "2026-10-13", "duree_min": 30})
    assert made.status_code == 201  # même jour que la séance détectée : comptée une seule fois
    manual = client.post(
        "/api/strength/sessions", json={"date": "2026-10-14", "note": "gainage"}
    ).json()
    body = client.get("/api/metrics/strength?weeks=2").json()
    current = body["weeks"][1]
    assert body["target"] == 2
    assert (current["detected"], current["manual"], current["count"]) == (1, 2, 2)
    assert current["target_met"] is True and body["weeks"][0]["target_met"] is False
    listed = client.get("/api/strength/sessions?from=2026-10-14").json()
    assert [r["id"] for r in listed] == [manual["id"]]
    assert client.delete(f"/api/strength/sessions/{manual['id']}").status_code == 204
    assert client.get("/api/metrics/strength?weeks=2").json()["weeks"][1]["count"] == 1
    assert client.delete("/api/strength/sessions/999").status_code == 404
    bad = client.post("/api/strength/sessions", json={"date": "2026-10-14", "duree_min": 0})
    assert bad.status_code == 422
    assert client.put("/api/profile", json={"renfo_objectif_hebdo": 99}).status_code == 422


# --- objectif de course -------------------------------------------------------------------------


def test_race_goal_defaults_to_the_next_race(client: TestClient) -> None:
    add(client, "r1", at(date(2026, 10, 3)), 150, km=20, gain=1000)
    add(client, "r2", at(date(2026, 10, 10)), 60, km=12, gain=400)
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.add(
            RawPayload(
                source="garmin", type="wellness", external_key="2026-10-14",
                fetched_at=at(TODAY), hash="x",
                payload={"race_predictions": {"time5K": 1290, "timeHalfMarathon": 5900.0}},
            )
        )  # fmt: skip
        s.commit()
    body = client.get("/api/metrics/race-goal").json()
    assert body["nom"] == "Trail des 3 Rocs" and body["date"] == "2026-11-08"
    assert body["days_left"] == 24 and body["distance_km"] == 31 and body["dplus_m"] == 1600
    recent = body["recent"]
    assert recent["distance_km"] == pytest.approx(32) and recent["dplus_m"] == pytest.approx(1400)
    assert recent["longest_km_vs_race_pct"] == pytest.approx(20 / 31 * 100)
    assert [(p["label"], p["seconds"]) for p in body["predictions"]] == [
        ("5 km", 1290),
        ("Semi-marathon", 5900),
    ]
    assert "estimation de la montre" in body["predictions"][0]["note"]
    proj = body["projection"]
    rest, kept = proj["scenarios"]
    assert (
        proj["days"]
        == (date(2026, 11, 8) - TODAY).days + (TODAY - date.fromisoformat(proj["from_date"])).days
    )
    assert rest["daily_load"] == 0 and rest["tsb"] > kept["tsb"]
    other = client.get("/api/metrics/race-goal?goal_id=2").json()
    assert other["nom"] == "Trail de Bruniquel"
    assert client.get("/api/metrics/race-goal?goal_id=999").status_code == 404


def test_race_goal_without_upcoming_race_is_404(client: TestClient) -> None:
    for goal in client.get("/api/goals").json():
        client.delete(f"/api/goals/{goal['id']}")
    assert client.get("/api/metrics/race-goal").status_code == 404


def test_race_goal_without_data_invents_nothing(client: TestClient) -> None:
    body = client.get("/api/metrics/race-goal").json()
    assert body["recent"]["distance_km"] == 0 and body["recent"]["longest_km"] is None
    assert body["predictions"] == [] and body["projection"] is None


# --- nutrition ----------------------------------------------------------------------------------


def test_fueling_crud_and_validation(client: TestClient) -> None:
    run = add(client, "long", at(date(2026, 10, 10)), 240, km=30, gain=1200)
    made = client.post(
        "/api/fueling",
        json={"activity_id": run, "glucides_g_par_h": 72.5, "score_digestif": 4, "note": " gels "},
    )
    assert made.status_code == 201
    entry = made.json()
    assert entry["note"] == "gels" and entry["glucides_g_par_h"] == 72.5
    dup = client.post(
        "/api/fueling", json={"activity_id": run, "glucides_g_par_h": 60, "score_digestif": 3}
    )
    assert dup.status_code == 409
    upd = client.put(
        f"/api/fueling/{entry['id']}", json={"glucides_g_par_h": 80, "score_digestif": 2}
    )
    assert (
        upd.status_code == 200 and upd.json()["note"] is None and upd.json()["score_digestif"] == 2
    )
    assert [e["id"] for e in client.get("/api/fueling").json()] == [entry["id"]]
    for bad in (
        {"activity_id": run, "glucides_g_par_h": -1, "score_digestif": 3},
        {"activity_id": run, "glucides_g_par_h": 60, "score_digestif": 6},
        {"activity_id": run, "glucides_g_par_h": 400, "score_digestif": 3},
        {"activity_id": run, "glucides_g_par_h": 60, "score_digestif": 3, "extra": 1},
    ):
        assert client.post("/api/fueling", json=bad).status_code == 422
    missing = client.post(
        "/api/fueling", json={"activity_id": 999, "glucides_g_par_h": 60, "score_digestif": 3}
    )
    assert missing.status_code == 422
    assert (
        client.put(
            "/api/fueling/999", json={"glucides_g_par_h": 1, "score_digestif": 1}
        ).status_code
        == 404
    )
    assert client.delete(f"/api/fueling/{entry['id']}").status_code == 204
    assert client.delete(f"/api/fueling/{entry['id']}").status_code == 404
    assert client.get("/api/fueling").json() == []


def test_fueling_series_for_long_outings(client: TestClient) -> None:
    a = add(client, "l1", at(date(2026, 9, 20)), 240, km=30, gain=1200)
    add(client, "short", at(date(2026, 9, 25)), 90, km=12, gain=300)
    b = add(client, "l2", at(date(2026, 10, 4)), 180, km=24, gain=900)
    add(client, "l3", at(date(2026, 10, 11)), 200, km=26, gain=1000)
    for act, carbs, gi in ((a, 60, 4), (b, 75, 3)):
        client.post(
            "/api/fueling",
            json={"activity_id": act, "glucides_g_par_h": carbs, "score_digestif": gi},
        )
    body = client.get("/api/fueling/series").json()
    assert [p["day"] for p in body["points"]] == ["2026-09-20", "2026-10-04", "2026-10-11"]
    assert [p["carbs_g_per_h"] for p in body["points"]] == [60, 75, None]
    assert [p["carbs_change_g_per_h"] for p in body["points"]] == [None, 15, None]
    assert body["missing"] == 1 and body["min_hours"] == 2.5
    assert body["points"][0]["carbs_total_g"] == pytest.approx(240)
    wider = client.get("/api/fueling/series?min_hours=1").json()
    assert len(wider["points"]) == 4
    assert client.get("/api/fueling/series?min_hours=0").status_code == 422


def test_fueling_follows_the_deduplicated_session(client: TestClient) -> None:
    garmin = add(client, "g", at(date(2026, 10, 10)), 200, source="garmin")
    twin = add(client, "i", datetime(2026, 10, 10, 6, 0, 20), 201, source="intervals")
    assert (
        client.post(
            "/api/fueling", json={"activity_id": twin, "glucides_g_par_h": 70, "score_digestif": 3}
        ).status_code
        == 201
    )
    again = client.post(
        "/api/fueling", json={"activity_id": garmin, "glucides_g_par_h": 50, "score_digestif": 1}
    )
    assert again.status_code == 409  # même séance réelle : une seule saisie
    points = client.get("/api/fueling/series").json()["points"]
    assert len(points) == 1 and points[0]["carbs_g_per_h"] == 70


# --- course du jour -----------------------------------------------------------------------------


def test_race_session_gap_is_computed_but_hr_zones_stay_excluded(client: TestClient) -> None:
    from tests.test_activities_api import hill_stream

    race = add(client, "race", at(date(2026, 10, 11)), 20, race=True, stream=hill_stream())
    detail = client.get(f"/api/activities/{race}").json()
    assert detail["gap_s_per_km"] is not None  # l'allure n'est pas biaisée par l'excitation
    assert any("FC de compétition" in n for n in detail["notes"])
    intensity = client.get("/api/metrics/intensity?weeks=2").json()
    assert sum(w["races_excluded"] for w in intensity["weeks"]) == 1
