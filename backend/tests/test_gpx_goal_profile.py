"""GPX (sécurité, distance, dénivelé) et profil altimétrique d'un objectif de course."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.gpx import GpxError, TrackPoint, haversine_m, parse_gpx, summarize
from app.main import create_app


def gpx(n: int = 101, ele_step: float = 1.0, with_ele: bool = True, ns: bool = True) -> str:
    """Trace le long d'un méridien : 0,001° de latitude ≈ 111,2 m ; +`ele_step` m par point."""
    xmlns = ' xmlns="http://www.topografix.com/GPX/1/1"' if ns else ""
    pts = "".join(
        f'<trkpt lat="{45 + i * 0.001:.6f}" lon="6.0"><ele>{500 + i * ele_step}</ele>'
        f"<time>2026-10-01T06:{i // 60:02d}:{i % 60:02d}Z</time></trkpt>"
        if with_ele
        else f'<trkpt lat="{45 + i * 0.001:.6f}" lon="6.0"></trkpt>'
        for i in range(n)
    )
    return f'<?xml version="1.0"?><gpx version="1.1"{xmlns}><trk><trkseg>{pts}</trkseg></trk></gpx>'


def test_haversine_one_millidegree_of_latitude() -> None:
    d = haversine_m(TrackPoint(45.0, 6.0, None), TrackPoint(45.001, 6.0, None))
    assert d == pytest.approx(111.195, abs=0.05)  # 6 371 008,8 m × 0,001° en radians


def test_summary_distance_gain_and_profile() -> None:
    s = summarize(parse_gpx(gpx()))
    assert s.distance_km == pytest.approx(11.1195, abs=0.01)  # 100 intervalles × 111,195 m
    assert s.dplus_m == pytest.approx(100, abs=6) and s.dminus_m == pytest.approx(0, abs=1)
    assert s.profile[0][0] == 0 and s.profile[-1][0] == pytest.approx(11.12, abs=0.01)
    assert len(s.profile) <= 300 and all(
        a <= b for (_, a), (_, b) in zip(s.profile, s.profile[1:], strict=False)
    )


def test_profile_is_downsampled() -> None:
    s = summarize(parse_gpx(gpx(n=1500, ele_step=0.1)), max_points=100)
    assert 90 <= len(s.profile) <= 102


def test_gpx_without_namespace_and_without_elevation() -> None:
    assert len(parse_gpx(gpx(n=5, ns=False))) == 5
    s = summarize(parse_gpx(gpx(n=5, with_ele=False)))
    assert s.profile == [] and s.dplus_m is None and s.distance_km > 0


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("pas du xml", "XML invalide"),
        ("<html></html>", "n'est pas un GPX"),
        ('<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>', "moins de 2 points"),
        (
            '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "boom">]><gpx>&a;</gpx>',
            "non autorisées",
        ),
        ("x" * 5_000_001, "trop volumineux"),
    ],
)
def test_invalid_or_hostile_gpx_is_rejected(content: str, message: str) -> None:
    with pytest.raises(GpxError, match=message):
        parse_gpx(content)


def test_points_with_invalid_coordinates_are_ignored() -> None:
    text = (
        '<gpx><trk><trkseg><trkpt lat="95" lon="0"/><trkpt lat="a" lon="0"/>'
        '<trkpt lat="45" lon="6"/><trkpt lat="45.001" lon="6"/></trkseg></trk></gpx>'
    )
    assert len(parse_gpx(text)) == 2


# --- API ----------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "g.db"), scheduler_enabled=False)
    with TestClient(create_app(settings)) as c:
        yield c


def goal_id(client: TestClient, **over: object) -> int:
    body = {"nom": "Test", "date": "2027-03-01", "priorite": 1, **over}
    return int(client.post("/api/goals", json=body).json()["id"])


def test_manual_profile_points_roundtrip(client: TestClient) -> None:
    gid = goal_id(client)
    pts = [[0, 300], [5, 700], [10.5, 450]]
    r = client.put(f"/api/goals/{gid}/profile", json={"points": pts})
    assert r.status_code == 200 and r.json()["profil_points"] == pts
    assert client.get(f"/api/goals/{gid}").json()["profil_points"] == pts
    assert client.delete(f"/api/goals/{gid}/profile").json()["profil_points"] is None


@pytest.mark.parametrize(
    "points",
    [[[0, 1]], [[0, 1], [0, 2]], [[2, 1], [1, 2]], [[0, 1], [1, 99999]], [[-1, 1], [1, 2]]],
)
def test_invalid_profile_points_are_422(client: TestClient, points: list[list[float]]) -> None:
    gid = goal_id(client)
    assert client.put(f"/api/goals/{gid}/profile", json={"points": points}).status_code == 422


def test_gpx_import_sets_profile_and_optionally_fills_totals(client: TestClient) -> None:
    gid = goal_id(client)
    r = client.post(f"/api/goals/{gid}/profile/gpx", json={"gpx": gpx(), "apply_totals": True})
    body = r.json()
    assert r.status_code == 200 and body["points"] > 50
    assert body["goal"]["distance_km"] == pytest.approx(11.1, abs=0.05)
    assert body["goal"]["dplus_m"] == pytest.approx(100, abs=6)
    # des totaux déjà saisis ne sont jamais écrasés
    kept = goal_id(client, distance_km=31, dplus_m=1600)
    r = client.post(
        f"/api/goals/{kept}/profile/gpx", json={"gpx": gpx(), "apply_totals": True}
    ).json()
    assert (r["goal"]["distance_km"], r["goal"]["dplus_m"]) == (31, 1600)
    # sans apply_totals, rien n'est modifié
    other = goal_id(client)
    r = client.post(f"/api/goals/{other}/profile/gpx", json={"gpx": gpx()}).json()
    assert r["goal"]["distance_km"] is None and r["goal"]["profil_points"]


def test_gpx_errors_are_readable_french(client: TestClient) -> None:
    gid = goal_id(client)
    bad = client.post(f"/api/goals/{gid}/profile/gpx", json={"gpx": "<html/>"})
    assert bad.status_code == 422 and "n'est pas un GPX" in bad.json()["detail"]
    flat = client.post(f"/api/goals/{gid}/profile/gpx", json={"gpx": gpx(with_ele=False)})
    assert flat.status_code == 422 and "altitude" in flat.json()["detail"]
    assert client.post("/api/goals/999/profile/gpx", json={"gpx": gpx()}).status_code == 404


def test_race_goal_report_carries_the_profile(client: TestClient) -> None:
    gid = goal_id(client, date="2026-12-01")
    client.put(f"/api/goals/{gid}/profile", json={"points": [[0, 100], [5, 600], [10, 100]]})
    body = client.get(f"/api/metrics/race-goal?goal_id={gid}").json()
    assert body["profile"] == [[0, 100], [5, 600], [10, 100]]
    assert body["profile_dplus_m"] == pytest.approx(500)
