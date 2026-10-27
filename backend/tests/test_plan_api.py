from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Activity, EveningEntry
from app.plan.seed import TYPICAL_WEEK, seed_demo_week
from app.sync.dedup import assign_dedup_groups

TODAY = date(2026, 10, 15)  # jeudi ; semaine du 12 au 18 octobre


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "p.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def add_activity(
    client: TestClient,
    ext: str,
    start: datetime,
    minutes: float,
    sport: str = "trail_running",
    gain: float | None = None,
    source: str = "garmin",
) -> int:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        act = Activity(
            source=source,
            external_id=ext,
            sport=sport,
            start_utc=start,
            duration_s=minutes * 60,
            distance_m=10000,
            elevation_gain_m=gain,
        )
        s.add(act)
        s.flush()
        assign_dedup_groups(s)
        s.commit()
        return act.id


def planned(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "date": "2026-10-13",
        "titre": "Footing",
        "type": "footing",
        "duree_min": 60,
        "zone_cible": "1-2",
        "dplus_cible": 100,
    }
    return body | over


# --- saisies du soir ------------------------------------------------------------------------


def test_entry_day_fields_partial_update_and_clear(client: TestClient) -> None:
    r = client.put("/api/entries/2026-10-14", json={"courbatures": 4})
    assert r.status_code == 200
    assert r.json()["courbatures"] == 4 and r.json()["malade"] is None
    r = client.put("/api/entries/2026-10-14", json={"malade": False, "note": "  jambes lourdes "})
    body = r.json()
    assert body["courbatures"] == 4  # inchangé
    assert body["malade"] is False and body["note"] == "jambes lourdes"
    r = client.put(
        "/api/entries/2026-10-14", json={"courbatures": None, "malade": None, "note": ""}
    )
    assert r.status_code == 200 and r.json()["courbatures"] is None
    assert client.get("/api/entries/2026-10-14").status_code == 404  # rien ne reste : ligne retirée


def test_entry_empty_body_is_accepted_and_changes_nothing(client: TestClient) -> None:
    r = client.put("/api/entries/2026-10-14", json={})
    assert r.status_code == 200 and r.json()["sessions"] == []


def test_entry_validation_is_strict(client: TestClient) -> None:

    def put(day: str, body: dict[str, Any]) -> Any:
        return client.put(f"/api/entries/{day}", json=body)

    assert put("2026-10-14", {"courbatures": 11}).status_code == 422
    assert put("2026-10-14", {"courbatures": -1}).status_code == 422
    assert put("2026-10-14", {"courbatures": 2.5}).status_code == 422
    assert put("2026-10-14", {"malade": "peut-être"}).status_code == 422
    assert put("2026-10-14", {"rpe": 11}).status_code == 422
    assert put("2026-10-14", {"inconnu": 1}).status_code == 422  # champs inconnus refusés
    assert put("2026-10-14", {"note": "x" * 2001}).status_code == 422
    assert put("2026-10-16", {"courbatures": 1}).status_code == 422  # date future
    assert put("pas-une-date", {}).status_code == 422
    assert put("2026-10-14", {"sessions": [{"activity_id": 1, "rpe": 12}]}).status_code == 422


def test_rpe_shortcut_attaches_to_the_single_session(client: TestClient) -> None:
    aid = add_activity(client, "a", datetime(2026, 10, 14, 6), 60)
    r = client.put("/api/entries/2026-10-14", json={"rpe": 6, "courbatures": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["sessions"] == [
        {"activity_id": aid, "rpe": 6, "sport": "trail_running", "duration_min": 60.0}
    ]
    assert body["courbatures"] == 3
    # modifier : toujours une seule saisie pour la séance
    r = client.put("/api/entries/2026-10-14", json={"rpe": 7})
    assert [s["rpe"] for s in r.json()["sessions"]] == [7]
    # null efface le RPE du jour
    r = client.put("/api/entries/2026-10-14", json={"rpe": None})
    assert r.json()["sessions"] == [] and r.json()["courbatures"] == 3


def test_rpe_shortcut_needs_exactly_one_session(client: TestClient) -> None:
    r = client.put("/api/entries/2026-10-14", json={"rpe": 5})
    assert r.status_code == 422 and "Aucune séance" in r.json()["detail"]
    a1 = add_activity(client, "a", datetime(2026, 10, 14, 6), 45)
    a2 = add_activity(client, "b", datetime(2026, 10, 14, 16), 30)
    r = client.put("/api/entries/2026-10-14", json={"rpe": 5})
    assert r.status_code == 422 and "Plusieurs séances" in r.json()["detail"]
    r = client.put(
        "/api/entries/2026-10-14",
        json={"sessions": [{"activity_id": a1, "rpe": 4}, {"activity_id": a2, "rpe": 8}]},
    )
    assert r.status_code == 200
    assert {s["activity_id"]: s["rpe"] for s in r.json()["sessions"]} == {a1: 4, a2: 8}
    r = client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": a1, "rpe": None}]})
    assert [s["activity_id"] for s in r.json()["sessions"]] == [a2]


def test_session_must_belong_to_the_day(client: TestClient) -> None:
    other = add_activity(client, "a", datetime(2026, 10, 13, 6), 45)
    r = client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": other, "rpe": 4}]})
    assert r.status_code == 422
    r = client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": 999, "rpe": 4}]})
    assert r.status_code == 422
    assert client.get("/api/entries/2026-10-14").status_code == 404  # rien n'a été écrit


def test_local_day_is_used_for_entries(client: TestClient) -> None:
    # 22 h 30 UTC le 13 octobre = 00 h 30 le 14 octobre à Paris (UTC+2)
    aid = add_activity(client, "late", datetime(2026, 10, 13, 22, 30), 40)
    r = client.put("/api/entries/2026-10-14", json={"rpe": 5})
    assert r.status_code == 200 and r.json()["sessions"][0]["activity_id"] == aid


def test_one_rpe_per_real_session_across_sources(client: TestClient) -> None:
    g = add_activity(client, "g", datetime(2026, 10, 14, 6, 0, 0), 60, source="garmin")
    i = add_activity(client, "i", datetime(2026, 10, 14, 6, 0, 20), 61, source="intervals")
    client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": g, "rpe": 5}]})
    r = client.put("/api/entries/2026-10-14", json={"sessions": [{"activity_id": i, "rpe": 7}]})
    assert [(s["activity_id"], s["rpe"]) for s in r.json()["sessions"]] == [(i, 7)]


def test_list_entries(client: TestClient) -> None:
    client.put("/api/entries/2026-10-12", json={"courbatures": 2})
    client.put("/api/entries/2026-10-14", json={"note": "ok"})
    rows = client.get("/api/entries", params={"from": "2026-10-01", "to": "2026-10-15"}).json()
    assert [r["date"] for r in rows] == ["2026-10-12", "2026-10-14"]
    assert len(client.get("/api/entries").json()) == 2  # 30 derniers jours par défaut
    assert (
        client.get("/api/entries", params={"from": "2026-10-15", "to": "2026-10-01"}).status_code
        == 422
    )
    assert client.get("/api/entries", params={"from": "2020-01-01"}).status_code == 422


def test_srpe_flows_into_week_metrics(client: TestClient) -> None:
    add_activity(client, "a", datetime(2026, 10, 14, 6), 60)
    client.put("/api/entries/2026-10-14", json={"rpe": 6})
    srpe = client.get("/api/metrics/week").json()["srpe"]
    assert srpe["total_load_au"] == 6 * 60 and srpe["entries"] == 1


# --- programme ------------------------------------------------------------------------------


def test_plan_crud(client: TestClient) -> None:
    r = client.post("/api/plan/sessions", json=planned())
    assert r.status_code == 201
    created = r.json()
    assert (
        created["type_label"] == "Footing" and created["status"] == "manqué"
    )  # jour passé, rien fait
    sid = created["id"]
    assert client.get(f"/api/plan/sessions/{sid}").json()["titre"] == "Footing"

    r = client.put(
        f"/api/plan/sessions/{sid}", json=planned(titre="Côtes", type="cotes", duree_min=50)
    )
    assert (
        r.status_code == 200 and r.json()["type_label"] == "Côtes" and r.json()["duree_min"] == 50
    )

    listed = client.get(
        "/api/plan/sessions", params={"from": "2026-10-12", "to": "2026-10-18"}
    ).json()
    assert [s["id"] for s in listed] == [sid]
    assert client.delete(f"/api/plan/sessions/{sid}").status_code == 204
    assert client.get(f"/api/plan/sessions/{sid}").status_code == 404
    assert client.delete(f"/api/plan/sessions/{sid}").status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "yoga"},
        {"titre": ""},
        {"duree_min": 0},
        {"zone_cible": "6"},
        {"zone_cible": "2-1"},
        {"dplus_cible": -5},
        {"date": "2026-13-40"},
        {"envoyer_a_la_montre": True},
    ],
)
def test_plan_validation(client: TestClient, bad: dict[str, Any]) -> None:
    assert client.post("/api/plan/sessions", json=planned(**bad)).status_code == 422


def test_status_follows_matching(client: TestClient) -> None:
    sid = client.post("/api/plan/sessions", json=planned(date="2026-10-15")).json()["id"]
    assert client.get(f"/api/plan/sessions/{sid}").json()["status"] == "à venir"  # aujourd'hui
    add_activity(client, "a", datetime(2026, 10, 15, 6), 30)  # 30 / 60 = 50 %
    assert client.get(f"/api/plan/sessions/{sid}").json()["status"] == "partiel"


def test_week_plan_day_by_day(client: TestClient) -> None:
    seeded = [
        planned(date="2026-10-12", titre="Repos", type="repos", duree_min=None, dplus_cible=None),
        planned(date="2026-10-13", titre="Footing", duree_min=60, dplus_cible=100),
        planned(date="2026-10-14", titre="Seuil", type="seuil", duree_min=70, dplus_cible=150),
        planned(date="2026-10-15", titre="Footing soir", duree_min=50),
        planned(date="2026-10-17", titre="Longue", type="longue", duree_min=150, dplus_cible=800),
    ]
    for body in seeded:
        assert client.post("/api/plan/sessions", json=body).status_code == 201
    add_activity(client, "lun", datetime(2026, 10, 12, 6), 35)  # sortie un jour de repos
    add_activity(client, "mar", datetime(2026, 10, 13, 6), 66, gain=130)  # fait
    add_activity(client, "mer", datetime(2026, 10, 14, 6), 35, sport="cycling")  # sport différent
    add_activity(
        client, "dim", datetime(2026, 10, 18, 6), 90, gain=300
    )  # imprévu (futur : peu importe)

    r = client.get("/api/plan/week", params={"date": "2026-10-15"})
    assert r.status_code == 200
    week = r.json()
    assert (week["week_start"], week["week_end"]) == ("2026-10-12", "2026-10-18")
    days = {d["date"]: d for d in week["days"]}
    assert [d["weekday"] for d in week["days"]] == [
        "lundi",
        "mardi",
        "mercredi",
        "jeudi",
        "vendredi",
        "samedi",
        "dimanche",
    ]
    assert days["2026-10-12"]["status"] == "imprévu"  # repos prévu mais sortie
    assert len(days["2026-10-12"]["unplanned_activities"]) == 1
    tue = days["2026-10-13"]
    assert tue["status"] == "fait"
    assert tue["sessions"][0]["duration_delta_min"] == pytest.approx(6.0)
    assert tue["sessions"][0]["dplus_delta_m"] == 30
    assert tue["sessions"][0]["activity"]["duration_min"] == pytest.approx(66.0)
    assert days["2026-10-14"]["status"] == "manqué"
    assert [a["sport"] for a in days["2026-10-14"]["unplanned_activities"]] == ["cycling"]
    assert days["2026-10-15"]["status"] == "à venir" and days["2026-10-15"]["is_today"] is True
    assert days["2026-10-16"]["status"] is None and days["2026-10-16"]["sessions"] == []
    assert days["2026-10-17"]["status"] == "à venir"
    assert days["2026-10-18"]["status"] == "imprévu"
    assert week["planned_min"] == 60 + 70 + 50 + 150  # le repos ne compte pas
    assert week["done_min"] == pytest.approx(35 + 66 + 35 + 90)


def test_week_plan_includes_evening_entry(client: TestClient) -> None:
    client.put("/api/entries/2026-10-13", json={"courbatures": 5, "note": "mollets"})
    day = next(
        d
        for d in client.get("/api/plan/week", params={"date": "2026-10-13"}).json()["days"]
        if d["date"] == "2026-10-13"
    )
    assert day["entry"]["courbatures"] == 5 and day["entry"]["note"] == "mollets"


def test_empty_week(client: TestClient) -> None:
    week = client.get("/api/plan/week").json()
    assert week["week_start"] == "2026-10-12" and len(week["days"]) == 7
    assert week["planned_min"] == 0 and all(d["status"] is None for d in week["days"])
    assert client.get("/api/plan/week", params={"date": "n'importe quoi"}).status_code == 422


def test_seed_demo_week_is_80_20_with_six_run_days(client: TestClient) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        assert seed_demo_week(s, TODAY) == len(TYPICAL_WEEK)
        assert seed_demo_week(s, TODAY) == 0  # déjà semée : rien ne change
        assert seed_demo_week(s, TODAY, force=True) == len(TYPICAL_WEEK)
    week = client.get("/api/plan/week").json()
    run_days = {
        d["date"]
        for d in week["days"]
        for s in d["sessions"]
        if s["planned"]["type"] not in ("repos", "renfo")
    }
    assert len(run_days) == 6
    assert week["days"][0]["sessions"][0]["planned"]["type"] == "repos"


# --- identifiants conservés à la reconstruction ---------------------------------------------


def test_rebuild_keeps_ids_and_entries(tmp_path: Path) -> None:
    from sqlalchemy import select

    from app.db import make_engine, make_session_factory
    from app.main import run_migrations
    from app.models import RawPayload
    from app.sync.service import rebuild_normalized
    from tests.fake_connector import FAKE_NORMALIZER, activity_payload

    url = f"sqlite:///{tmp_path / 'r.db'}"
    run_migrations(url)
    engine = make_engine(url)
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(
            RawPayload(
                source="garmin",
                type="activity",
                external_key="a1",
                fetched_at=datetime(2026, 10, 14),
                payload=activity_payload("a1", "2026-10-14T06:00:00+00:00"),
                hash="h",
            )
        )
        s.commit()
        rebuild_normalized(s, {"garmin": FAKE_NORMALIZER})
        act = s.scalars(select(Activity)).one()
        act.is_race = True
        s.add(
            EveningEntry(
                kind="session",
                date=date(2026, 10, 14),
                activity_id=act.id,
                activity_start_utc=act.start_utc,
                rpe=6,
                updated_at=datetime(2026, 10, 14),
            )
        )
        s.commit()
        first_id = act.id

        rebuild_normalized(s, {"garmin": FAKE_NORMALIZER})
        act = s.scalars(select(Activity)).one()
        assert act.id == first_id and act.is_race is True  # même ligne, drapeau manuel conservé
        assert s.scalars(select(EveningEntry)).one().activity_id == first_id

        # l'activité disparaît (corruption) : la saisie est rattachée à la nouvelle ligne
        s.query(Activity).delete()
        s.commit()
        entry = s.scalars(select(EveningEntry)).one()
        assert entry.activity_id is None  # ON DELETE SET NULL, la saisie n'est pas perdue
        rebuild_normalized(s, {"garmin": FAKE_NORMALIZER})
        act = s.scalars(select(Activity)).one()
        assert s.scalars(select(EveningEntry)).one().activity_id == act.id
    engine.dispose()
