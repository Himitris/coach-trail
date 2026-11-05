"""Plan du jour J d'une course : validation stricte, remplacement, suppression, cascade."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "r.db"), scheduler_enabled=False)
    with TestClient(create_app(settings)) as c:
        yield c


def goal_id(client: TestClient) -> int:
    body = {"nom": "3 Rocs", "date": "2026-11-08", "distance_km": 31, "dplus_m": 1600, "priorite": 1}
    return int(client.post("/api/goals", json=body).json()["id"])


def doc(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": 1,
        "objectif": {"temps_cible_min": 270, "allure_cible": "8:40/km"},
        "jours_avant": [
            {"jour": -1, "repas": [{"heure": "19:30", "description": "Pâtes", "glucides_g": 120}]}
        ],
        "matin": {"reveil": "05:30", "repas": [{"heure": "06:00", "description": "Riz au lait"}]},
        "tranches": [
            {"debut_min": 0, "fin_min": 60, "zone": "Z2", "fc_min": 135, "fc_max": 150, "glucides_g": 60, "gels": 1},
            {"debut_min": 60, "fin_min": 120, "zone": "Z2", "glucides_g": 70, "gels": 1.5},
        ],
        "ravitaillements": [{"km": 12, "nom": "Ravito 1", "action": "Recharger les flasques"}],
        "materiel": ["Gilet 10 L"],
    }
    base.update(over)
    return base


def test_put_get_roundtrip_and_replace(client: TestClient) -> None:
    gid = goal_id(client)
    assert client.get(f"/api/goals/{gid}/race-plan").status_code == 404
    r = client.put(f"/api/goals/{gid}/race-plan", json=doc())
    assert r.status_code == 200 and r.json()["warnings"] == []
    got = client.get(f"/api/goals/{gid}/race-plan").json()
    assert got["data"]["objectif"]["temps_cible_min"] == 270
    assert len(got["data"]["tranches"]) == 2
    client.put(f"/api/goals/{gid}/race-plan", json=doc(materiel=["Frontale"]))
    assert client.get(f"/api/goals/{gid}/race-plan").json()["data"]["materiel"] == ["Frontale"]


def test_dry_run_writes_nothing(client: TestClient) -> None:
    gid = goal_id(client)
    assert client.put(f"/api/goals/{gid}/race-plan?dry_run=true", json=doc()).status_code == 200
    assert client.get(f"/api/goals/{gid}/race-plan").status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"inconnu": 1},
        {"tranches": [{"debut_min": 60, "fin_min": 30}]},
        {"tranches": [{"debut_min": 0, "fin_min": 60, "fc_min": 160, "fc_max": 150}]},
        {"matin": {"reveil": "5h30"}},
        {"jours_avant": [{"jour": 1}]},
        {"jours_avant": [{"jour": -1}, {"jour": -1}]},
        {"version": 2},
    ],
)
def test_invalid_documents_are_rejected(client: TestClient, bad: dict[str, Any]) -> None:
    gid = goal_id(client)
    assert client.put(f"/api/goals/{gid}/race-plan", json=doc(**bad)).status_code == 422


def test_empty_document_is_rejected(client: TestClient) -> None:
    gid = goal_id(client)
    assert client.put(f"/api/goals/{gid}/race-plan", json={"version": 1}).status_code == 422


def test_gap_between_slices_is_a_warning(client: TestClient) -> None:
    gid = goal_id(client)
    slices = [{"debut_min": 0, "fin_min": 60}, {"debut_min": 90, "fin_min": 120}]
    r = client.put(f"/api/goals/{gid}/race-plan", json=doc(tranches=slices))
    assert r.status_code == 200 and "60 et 90" in r.json()["warnings"][0]


def test_delete_and_cascade_with_goal(client: TestClient) -> None:
    gid = goal_id(client)
    client.put(f"/api/goals/{gid}/race-plan", json=doc())
    assert client.delete(f"/api/goals/{gid}/race-plan").status_code == 204
    assert client.get(f"/api/goals/{gid}/race-plan").status_code == 404
    client.put(f"/api/goals/{gid}/race-plan", json=doc())
    client.delete(f"/api/goals/{gid}")
    assert client.get(f"/api/goals/{gid}/race-plan").status_code == 404


def test_unknown_goal(client: TestClient) -> None:
    assert client.put("/api/goals/999/race-plan", json=doc()).status_code == 404
