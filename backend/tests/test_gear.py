"""Matériel : kilométrage par paire, seuil d'usure, alerte douce, affectation manuelle, Garmin."""

from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.garmin.normalize import GARMIN_NORMALIZER
from app.gear import DEFAULT_THRESHOLD_KM, status_for
from app.main import create_app
from app.models import Activity
from tests.test_activities_api import add

TODAY = date(2026, 10, 15)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(Settings(database_path=str(tmp_path / "g.db"), scheduler_enabled=False))
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def run(
    client: TestClient, ext: str, day: int, km: float, gear: str | None = None, **kw: Any
) -> int:
    act_id = add(client, ext, datetime(2026, 10, day, 6), 60, "running", km, 50, 140, **kw)
    if gear:
        factory = client.app.state.session_factory  # type: ignore[attr-defined]
        with factory() as s:
            s.get(Activity, act_id).gear = gear
            s.commit()
    return act_id


def report(client: TestClient) -> dict[str, Any]:
    data: dict[str, Any] = client.get("/api/gear").json()
    return data


def by_name(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {g["nom"]: g for g in data["items"]}


# --- règles d'alerte ----------------------------------------------------------------------------


def test_status_thresholds_are_soft_information() -> None:
    assert status_for(100, 800, False) == ("ok", None)
    assert status_for(719, 800, False)[0] == "ok"
    status, message = status_for(720, 800, False)  # 90 %
    assert (
        status == "surveiller" and "90 %" in (message or "") and "à surveiller" in (message or "")
    )
    status, message = status_for(800, 800, False)
    assert status == "atteint" and "information, pas une obligation" in (message or "")
    assert status_for(900, 800, True) == ("retire", None)  # paire retirée : plus d'alerte


# --- kilométrage --------------------------------------------------------------------------------


def test_mileage_per_pair_from_the_watch_gear_name(client: TestClient) -> None:
    run(client, "a", 1, 10, "Speedcross 6")
    run(client, "b", 3, 12.5, "Speedcross 6")
    run(client, "c", 5, 8, "Pegasus 40")
    run(client, "d", 6, 9)  # sans matériel
    data = report(client)
    items = by_name(data)
    assert set(items) == {"Speedcross 6", "Pegasus 40"}
    s = items["Speedcross 6"]
    assert (s["km_total"], s["activities"], s["last_used"]) == (22.5, 2, "2026-10-03")
    assert s["registered"] is False and s["id"] is None and s["seuil_km"] == DEFAULT_THRESHOLD_KM
    assert s["usage_pct"] == pytest.approx(22.5 / 800 * 100) and s["status"] == "ok"
    assert [u["distance_km"] for u in data["unassigned"]] == [9] and data["unassigned_total"] == 1
    assert "repère personnel" in data["evidence"]["summary"]


def test_a_session_seen_by_two_sources_is_counted_once(client: TestClient) -> None:
    run(client, "g", 10, 10, "Speedcross 6", source="garmin")
    twin = add(
        client,
        "i",
        datetime(2026, 10, 10, 6, 0, 20),
        61,
        "running",
        10.1,
        50,
        140,
        source="intervals",
    )
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.get(Activity, twin).gear = "Speedcross 6"
        s.commit()
    item = by_name(report(client))["Speedcross 6"]
    assert item["activities"] == 1 and item["km_total"] == 10


def test_gear_from_the_other_source_fills_the_garmin_session(client: TestClient) -> None:
    run(client, "g", 10, 10, source="garmin")  # Garmin ne dit rien
    twin = add(
        client,
        "i",
        datetime(2026, 10, 10, 6, 0, 20),
        61,
        "running",
        10,
        50,
        140,
        source="intervals",
    )
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.get(Activity, twin).gear = "Speedcross 6"
        s.commit()
    assert by_name(report(client))["Speedcross 6"]["activities"] == 1


# --- paires enregistrées, seuil, alerte ---------------------------------------------------------


def test_register_edit_threshold_and_soft_alert(client: TestClient) -> None:
    for i in range(1, 10):
        run(client, f"r{i}", i, 10, "Speedcross 6")  # 90 km
    gid = client.post("/api/gear", json={"nom": "Speedcross 6", "seuil_km": 100}).json()["id"]
    item = by_name(report(client))["Speedcross 6"]
    assert item["registered"] is True and item["id"] == gid and item["status"] == "surveiller"
    assert "90 %" in item["message"]
    client.put(f"/api/gear/{gid}", json={"km_initial": 15.5})  # chaussures déjà usées avant l'appli
    item = by_name(report(client))["Speedcross 6"]
    assert item["km_total"] == pytest.approx(105.5) and item["status"] == "atteint"
    client.put(f"/api/gear/{gid}", json={"seuil_km": 600})
    assert by_name(report(client))["Speedcross 6"]["status"] == "ok"
    client.put(f"/api/gear/{gid}", json={"seuil_km": 100, "retire": True})
    assert by_name(report(client))["Speedcross 6"]["status"] == "retire"


def test_registered_pair_without_runs_is_listed(client: TestClient) -> None:
    client.post("/api/gear", json={"nom": "Neuves", "km_initial": 0})
    item = by_name(report(client))["Neuves"]
    assert item["km_total"] == 0 and item["activities"] == 0 and item["last_used"] is None


def test_validation_and_errors(client: TestClient) -> None:
    assert client.post("/api/gear", json={"nom": "  "}).status_code == 422
    assert client.post("/api/gear", json={"nom": "X", "seuil_km": 10}).status_code == 422
    assert client.post("/api/gear", json={"nom": "X", "km_initial": -1}).status_code == 422
    assert client.post("/api/gear", json={"nom": "X", "extra": 1}).status_code == 422
    client.post("/api/gear", json={"nom": "Doublon"})
    assert client.post("/api/gear", json={"nom": "Doublon"}).status_code == 409
    other = client.post("/api/gear", json={"nom": "Autre"}).json()["id"]
    assert client.put(f"/api/gear/{other}", json={"nom": "Doublon"}).status_code == 409
    assert client.put(f"/api/gear/{other}", json={"seuil_km": None}).status_code == 422
    assert client.put("/api/gear/999", json={"seuil_km": 500}).status_code == 404
    assert client.delete("/api/gear/999").status_code == 404


# --- affectation manuelle -----------------------------------------------------------------------


def test_manual_assignment_beats_the_watch_and_can_be_cleared(client: TestClient) -> None:
    a = run(client, "a", 1, 10, "Speedcross 6")
    b = run(client, "b", 2, 12)  # sans matériel
    pegasus = client.post("/api/gear", json={"nom": "Pegasus 40"}).json()["id"]
    assert (
        client.put(
            "/api/gear/assign/activity", json={"activity_id": b, "gear_id": pegasus}
        ).status_code
        == 204
    )
    assert (
        client.put(
            "/api/gear/assign/activity", json={"activity_id": a, "gear_id": pegasus}
        ).status_code
        == 204
    )
    items = by_name(report(client))
    assert items["Pegasus 40"]["km_total"] == 22 and items["Pegasus 40"]["activities"] == 2
    assert (
        "Speedcross 6" not in items or items["Speedcross 6"]["activities"] == 0
    )  # la manuelle prévaut
    assert report(client)["unassigned_total"] == 0
    client.put("/api/gear/assign/activity", json={"activity_id": a, "gear_id": None})
    items = by_name(report(client))
    assert items["Speedcross 6"]["activities"] == 1 and items["Pegasus 40"]["activities"] == 1


def test_assignment_follows_the_deduplicated_session_and_survives_a_resync(
    client: TestClient,
) -> None:
    g = run(client, "g", 10, 10, source="garmin")
    i = add(
        client,
        "i",
        datetime(2026, 10, 10, 6, 0, 20),
        61,
        "running",
        10,
        50,
        140,
        source="intervals",
    )
    pair = client.post("/api/gear", json={"nom": "Pegasus 40"}).json()["id"]
    client.put("/api/gear/assign/activity", json={"activity_id": i, "gear_id": pair})
    assert by_name(report(client))["Pegasus 40"]["activities"] == 1
    other = client.post("/api/gear", json={"nom": "Autre"}).json()["id"]
    client.put(
        "/api/gear/assign/activity", json={"activity_id": g, "gear_id": other}
    )  # réaffecte la même séance
    items = by_name(report(client))
    assert items["Pegasus 40"]["activities"] == 0 and items["Autre"]["activities"] == 1


def test_assignment_errors_and_cascade(client: TestClient) -> None:
    a = run(client, "a", 1, 10)
    assert (
        client.put(
            "/api/gear/assign/activity", json={"activity_id": 999, "gear_id": None}
        ).status_code
        == 422
    )
    assert (
        client.put("/api/gear/assign/activity", json={"activity_id": a, "gear_id": 999}).status_code
        == 404
    )
    pair = client.post("/api/gear", json={"nom": "P"}).json()["id"]
    client.put("/api/gear/assign/activity", json={"activity_id": a, "gear_id": pair})
    client.delete(f"/api/gear/{pair}")  # supprimer la paire retire ses affectations
    assert report(client)["unassigned_total"] == 1 and report(client)["items"] == []


def test_only_running_sports_are_offered_for_assignment(client: TestClient) -> None:
    add(client, "bike", datetime(2026, 10, 2, 6), 60, "cycling", 30, 100, 130)
    add(client, "trail", datetime(2026, 10, 3, 6), 60, "trail_running", 10, 300, 150)
    data = report(client)
    assert [u["sport"] for u in data["unassigned"]] == ["trail_running"]


# --- Garmin : matériel de l'activité ------------------------------------------------------------


def test_garmin_normalizer_reads_the_activity_gear() -> None:
    def activity(gear: Any) -> Any:
        return GARMIN_NORMALIZER.activity(
            {
                "summary": {
                    "activityId": 1, "startTimeGMT": "2026-10-01 06:00:00", "duration": 3600.0,
                    "activityType": {"typeKey": "trail_running"},
                },
                "detail": None,
                "gear": gear,
            }
        )  # fmt: skip

    assert activity([{"displayName": "Speedcross 6"}]).gear == "Speedcross 6"
    assert activity({"customMakeModel": "Salomon Speedcross"}).gear == "Salomon Speedcross"
    assert (
        activity([{"foo": 1}]).gear is None
        and activity(None).gear is None
        and activity([]).gear is None
    )
    assert activity("bizarre").gear is None  # jamais d'exception, jamais de nom inventé


def test_gear_series_for_csv_and_widget_export(client: TestClient) -> None:
    run(client, "a", 1, 10, "Speedcross 6")
    r = client.get(
        "/api/export",
        params={"format": "csv", "series": "gear", "from": "2026-10-01", "to": "2026-10-15"},
    )
    lines = r.text.splitlines()
    assert (
        lines[0]
        == "paire,km_total,seuil_km,usage_pct,seances_affectees,derniere_utilisation,statut"
    )
    assert (
        lines[1].startswith("Speedcross 6,10,800,1.2")
        and lines[1].endswith("2026-10-01,ok")
        or "2026-10-01" in lines[1]
    )
