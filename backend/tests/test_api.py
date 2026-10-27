from fastapi.testclient import TestClient
from sqlalchemy import text

from app import __version__


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": __version__, "db": "ok"}


def test_sqlite_pragmas(client: TestClient) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        assert s.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert s.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_profile_defaults_and_update(client: TestClient) -> None:
    p = client.get("/api/profile").json()
    assert p["fc_max"] == 195
    assert p["fc_repos"] is None
    assert len(p["zones"]) == 5

    r = client.put("/api/profile", json={"fc_repos": 48, "seuil_lactique_fc": 172})
    assert r.status_code == 200
    body = r.json()
    assert body["fc_repos"] == 48
    assert body["seuil_lactique_fc"] == 172
    assert body["fc_max"] == 195  # champ non fourni : inchangé
    assert client.get("/api/profile").json()["fc_repos"] == 48


def test_profile_validation(client: TestClient) -> None:
    assert client.put("/api/profile", json={"fc_max": 10}).status_code == 422
    assert client.put("/api/profile", json={"fc_max": None}).status_code == 422


def test_goals_prefilled(client: TestClient) -> None:
    goals = client.get("/api/goals").json()
    assert [g["nom"] for g in goals] == ["Trail des 3 Rocs", "Trail de Bruniquel"]
    assert goals[0]["date"] == "2026-11-08"
    assert goals[0]["distance_km"] == 31
    assert goals[0]["dplus_m"] == 1600
    assert goals[1]["date"] == "2027-02-15"


def test_goals_crud(client: TestClient) -> None:
    r = client.post(
        "/api/goals",
        json={"nom": "UTMB test", "date": "2027-08-27", "distance_km": 100, "priorite": 3},
    )
    assert r.status_code == 201
    gid = r.json()["id"]

    assert client.get(f"/api/goals/{gid}").json()["nom"] == "UTMB test"

    r = client.put(
        f"/api/goals/{gid}",
        json={"nom": "Ultra", "date": "2027-09-01", "distance_km": 80, "dplus_m": 5000},
    )
    assert r.status_code == 200
    assert r.json()["nom"] == "Ultra"
    assert r.json()["dplus_m"] == 5000

    assert client.delete(f"/api/goals/{gid}").status_code == 204
    assert client.get(f"/api/goals/{gid}").status_code == 404
    assert client.delete(f"/api/goals/{gid}").status_code == 404


def test_goal_validation(client: TestClient) -> None:
    assert client.post("/api/goals", json={"nom": "", "date": "2027-01-01"}).status_code == 422
    assert client.post("/api/goals", json={"nom": "x", "date": "pas-une-date"}).status_code == 422
