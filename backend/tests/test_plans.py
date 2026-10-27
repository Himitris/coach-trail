"""Plans rattachés aux courses : migration, import v1/v2, chevauchements, attribution, suppression."""

import json
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
import sqlalchemy as sa
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.config import Settings
from app.main import BACKEND_DIR, create_app
from tests.test_activities_api import add

TODAY = date(2026, 10, 15)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "pl.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def session(day: str, **over: Any) -> dict[str, Any]:
    return {"date": day, "type": "footing", **over}


def post(client: TestClient, doc: Any, **params: Any) -> Any:
    return client.post("/api/plan/import", params=params, content=json.dumps(doc))


def v2(nom: str, sessions: list[dict[str, Any]], course: str | None = None) -> dict[str, Any]:
    plan: dict[str, Any] = {"nom": nom}
    if course:
        plan["course"] = course
    return {"version": 2, "plan": plan, "sessions": sessions}


def goal(client: TestClient, nom: str, day: str) -> int:
    r = client.post(
        "/api/goals", json={"nom": nom, "date": day, "distance_km": 31, "dplus_m": 1600}
    )
    assert r.status_code == 201
    return int(r.json()["id"])


# --- migration -----------------------------------------------------------------------------


def test_migration_groups_existing_sessions_in_a_legacy_plan(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'v1.db'}"
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "0011")
    engine = sa.create_engine(url)
    with engine.begin() as conn:
        for day in ("2026-10-20", "2026-11-03"):
            conn.execute(
                sa.text(
                    "INSERT INTO planned_session (date, titre, type) VALUES (:d, 'Footing', 'footing')"
                ),
                {"d": day},
            )
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        plan = conn.execute(sa.text("SELECT id, nom, date_debut, date_fin FROM plan")).one()
        ids = conn.execute(sa.text("SELECT DISTINCT plan_id FROM planned_session")).scalars().all()
    assert plan.nom == "Plan importé" and plan.date_debut == "2026-10-20"
    assert plan.date_fin == "2026-11-03" and ids == [plan.id]
    command.downgrade(cfg, "0011")
    engine.dispose()


def test_migration_on_an_empty_database_creates_no_plan(tmp_path: Path) -> None:
    url = f"sqlite:///{tmp_path / 'empty.db'}"
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    engine = sa.create_engine(url)
    with engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM plan")).scalar_one() == 0
    engine.dispose()


# --- import -----------------------------------------------------------------------------------


def test_v1_import_creates_a_plan_named_after_its_first_day(client: TestClient) -> None:
    body = post(client, [session("2026-11-03"), session("2026-11-05")], dry_run="false").json()
    assert body["plan"]["nom"] == "Plan du 03/11/2026" and body["plan"]["action"] == "create"
    [plan] = client.get("/api/plans").json()
    assert plan["nb_seances"] == 2 and plan["date_debut"] == "2026-11-03"
    assert plan["date_fin"] == "2026-11-05" and plan["goal_id"] is None
    rows = client.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30").json()
    assert {r["plan_nom"] for r in rows} == {"Plan du 03/11/2026"}


def test_v2_import_links_the_course_and_reimport_updates_the_same_plan(client: TestClient) -> None:
    gid = goal(client, "Ultra de test", "2026-11-08")
    doc = v2("Fin de prépa", [session("2026-11-03"), session("2026-11-05")], "ultra de TEST")
    preview = post(client, doc).json()
    assert preview["plan"]["course_id"] == gid and preview["plan"]["action"] == "create"
    assert client.get("/api/plans").json() == []  # aperçu : rien d'écrit
    post(client, doc, dry_run="false")
    [plan] = client.get("/api/plans").json()
    assert plan["goal_id"] == gid and plan["goal_nom"] == "Ultra de test"

    again = post(client, doc, dry_run="false").json()
    assert again["plan"]["action"] == "update" and again["summary"]["unchanged_days"] == 2
    assert len(client.get("/api/plans").json()) == 1

    more = v2("fin de PRÉPA", [session("2026-11-06")])  # même nom (casse ignorée), un jour de plus
    post(client, more, dry_run="false")
    [plan] = client.get("/api/plans").json()
    assert plan["nb_seances"] == 3 and plan["date_fin"] == "2026-11-06" and plan["goal_id"] == gid


def test_unknown_course_is_a_warning_not_an_error(client: TestClient) -> None:
    body = post(
        client, v2("P", [session("2026-11-03")], "Marathon de Paris"), dry_run="false"
    ).json()
    assert body["applied"] is True and body["plan"]["course_id"] is None
    assert "non reconnue" in body["warnings"][0]
    assert client.get("/api/plans").json()[0]["goal_id"] is None


def test_course_can_be_given_by_date(client: TestClient) -> None:
    gid = goal(client, "Autre course", "2027-05-01")
    body = post(client, v2("P", [session("2026-11-03")], "2027-05-01")).json()
    assert body["plan"]["course_id"] == gid


def test_plan_block_requires_version_2_and_known_keys(client: TestClient) -> None:
    r = post(client, {"version": 1, "plan": {"nom": "x"}, "sessions": [session("2026-11-03")]})
    assert r.status_code == 422 and 'version": 2' in r.json()["detail"]["errors"][0]["message"]
    r = post(
        client, {"version": 2, "plan": {"nom": "x", "foo": 1}, "sessions": [session("2026-11-03")]}
    )
    assert r.status_code == 422 and "foo" in r.json()["detail"]["errors"][0]["message"]
    r = post(client, {"version": 2, "plan": {"nom": ""}, "sessions": [session("2026-11-03")]})
    assert r.status_code == 422


def test_next_plan_can_be_imported_in_advance_without_touching_the_first(
    client: TestClient,
) -> None:
    post(
        client,
        v2("Prépa 3 Rocs", [session("2026-10-28", titre="A"), session("2026-11-03", titre="B")]),
        dry_run="false",
    )
    nxt = v2(
        "Prépa Bruniquel", [session("2026-11-10", titre="C"), session("2026-11-12", titre="D")]
    )
    body = post(client, nxt, dry_run="false").json()
    assert body["summary"]["created_days"] == 2 and body["summary"]["overlap_days"] == 0
    plans = {p["nom"]: p for p in client.get("/api/plans").json()}
    assert plans["Prépa 3 Rocs"]["nb_seances"] == 2 and plans["Prépa Bruniquel"]["nb_seances"] == 2
    titles = {
        r["date"]: r["titre"]
        for r in client.get("/api/plan/sessions?from=2026-10-01&to=2026-11-30").json()
    }
    assert titles["2026-10-28"] == "A" and titles["2026-11-03"] == "B"


def test_overlap_with_another_plan_needs_explicit_confirmation(client: TestClient) -> None:
    post(
        client,
        v2(
            "Premier", [session("2026-11-03", titre="Ancien"), session("2026-11-04", titre="Reste")]
        ),
        dry_run="false",
    )
    other = v2(
        "Second", [session("2026-11-03", titre="Nouveau"), session("2026-11-20", titre="Libre")]
    )
    preview = post(client, other).json()
    day = preview["days"][0]
    assert day["action"] == "overlap" and "Premier" in day["reason"]
    assert preview["summary"]["overlap_days"] == 1

    skipped = post(client, other, dry_run="false").json()
    assert skipped["applied"] is True and skipped["summary"]["overlap_days"] == 1
    titles = {
        r["date"]: r["titre"]
        for r in client.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30").json()
    }
    assert titles["2026-11-03"] == "Ancien" and titles["2026-11-20"] == "Libre"

    forced = post(client, other, dry_run="false", confirm_overlap="true").json()
    assert forced["summary"]["replaced_days"] == 1
    rows = client.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30").json()
    assert {r["date"]: r["plan_nom"] for r in rows}["2026-11-03"] == "Second"
    plans = {p["nom"]: p for p in client.get("/api/plans").json()}
    assert plans["Premier"]["nb_seances"] == 1 and plans["Premier"]["date_debut"] == "2026-11-04"


def test_manually_created_sessions_without_plan_are_not_an_overlap(client: TestClient) -> None:
    client.post(
        "/api/plan/sessions", json={"date": "2026-11-03", "titre": "À la main", "type": "footing"}
    )
    body = post(client, v2("P", [session("2026-11-03", titre="Importé")])).json()
    assert body["days"][0]["action"] == "replace"


def test_nothing_applicable_creates_no_empty_plan(client: TestClient) -> None:
    post(client, v2("Premier", [session("2026-11-03", titre="X")]), dry_run="false")
    body = post(client, v2("Second", [session("2026-11-03", titre="Y")]), dry_run="false").json()
    assert body["applied"] is False
    assert [p["nom"] for p in client.get("/api/plans").json()] == ["Premier"]


# --- API des plans ------------------------------------------------------------------------------


def test_plan_crud_and_course_attribution(client: TestClient) -> None:
    gid = goal(client, "Ultra de test", "2026-11-08")
    created = client.post(
        "/api/plans", json={"nom": "Vide", "date_debut": "2026-11-01", "date_fin": "2026-11-08"}
    )
    assert created.status_code == 201
    pid = created.json()["id"]
    assert (
        client.post(
            "/api/plans", json={"nom": "Vide", "date_debut": "2026-11-01", "date_fin": "2026-11-08"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/plans", json={"nom": "X", "date_debut": "2026-11-09", "date_fin": "2026-11-08"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/plans",
            json={"nom": "X", "date_debut": "2026-11-01", "date_fin": "2026-11-08", "goal_id": 999},
        ).status_code
        == 404
    )

    attached = client.put(f"/api/plans/{pid}/course", json={"goal_id": gid}).json()
    assert attached["goal_nom"] == "Ultra de test"
    detached = client.put(f"/api/plans/{pid}/course", json={"goal_id": None}).json()
    assert detached["goal_id"] is None
    assert client.put(f"/api/plans/{pid}/course", json={"goal_id": 999}).status_code == 404

    renamed = client.put(
        f"/api/plans/{pid}",
        json={"nom": "Renommé", "date_debut": "2026-11-01", "date_fin": "2026-11-09"},
    )
    assert renamed.json()["nom"] == "Renommé"
    assert (
        client.put(
            "/api/plans/999",
            json={"nom": "x", "date_debut": "2026-11-01", "date_fin": "2026-11-09"},
        ).status_code
        == 404
    )


def test_deleting_a_goal_detaches_its_plans(client: TestClient) -> None:
    gid = goal(client, "Course", "2026-11-08")
    post(client, v2("P", [session("2026-11-03")], "Course"), dry_run="false")
    assert client.get("/api/plans").json()[0]["goal_id"] == gid
    assert client.delete(f"/api/goals/{gid}").status_code == 204
    assert client.get("/api/plans").json()[0]["goal_id"] is None


def test_deleting_a_plan_keeps_done_sessions_detached(client: TestClient) -> None:
    client.post(
        "/api/plan/sessions",
        json={"date": "2026-10-07", "titre": "Fait", "type": "footing", "duree_min": 60},
    )
    add(client, "done", datetime(2026, 10, 7, 6), 58, "running", 10, 50, 140)
    post(
        client,
        v2(
            "P",
            [
                session("2026-10-07", titre="Fait (plan)", duree_min=60),
                session("2026-11-03", titre="Futur"),
                session("2026-10-08", titre="Manquée"),
            ],
        ),
        dry_run="false",
        confirm_past_done="true",
    )
    [plan] = client.get("/api/plans").json()
    out = client.delete(f"/api/plans/{plan['id']}").json()
    assert out == {"removed": 2, "kept": 1}
    assert client.get("/api/plans").json() == []
    rows = client.get("/api/plan/sessions?from=2026-10-01&to=2026-11-30").json()
    assert [(r["titre"], r["plan_id"]) for r in rows] == [("Fait (plan)", None)]
    assert client.delete(f"/api/plans/{plan['id']}").status_code == 404


def test_week_exposes_the_plan_of_each_session(client: TestClient) -> None:
    post(client, v2("Mon plan", [session("2026-10-14", titre="Mercredi")]), dry_run="false")
    week = client.get("/api/plan/week?date=2026-10-14").json()
    planned = [s["planned"] for d in week["days"] for s in d["sessions"]]
    assert planned[0]["plan_nom"] == "Mon plan" and planned[0]["plan_id"] is not None


def test_editing_or_deleting_a_session_recomputes_plan_bounds(client: TestClient) -> None:
    post(client, v2("P", [session("2026-11-03"), session("2026-11-10")]), dry_run="false")
    rows = client.get("/api/plan/sessions?from=2026-11-01&to=2026-11-30").json()
    last = rows[-1]
    client.delete(f"/api/plan/sessions/{last['id']}")
    assert client.get("/api/plans").json()[0]["date_fin"] == "2026-11-03"
