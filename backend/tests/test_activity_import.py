"""Import manuel FIT / GPX : lecture, normalisation, idempotence, déduplication, erreurs."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import activity_import
from app.activity_import import ImportFailure, parse_activity
from app.config import Settings
from app.main import create_app
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector, activity_payload
from tests.fit_builder import build_fit

START = datetime(2026, 10, 10, 6, 0, tzinfo=UTC)
TODAY = date(2026, 10, 15)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(Settings(database_path=str(tmp_path / "i.db"), scheduler_enabled=False))
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def upload(client: TestClient, data: bytes, filename: str | None = None, **params: Any) -> Any:
    query = {**({"filename": filename} if filename else {}), **params}
    return client.post("/api/import/activity", params=query, content=data)


def gpx(
    n: int = 120,
    hr: bool = True,
    ele: bool = True,
    time: bool = True,
    kind: str | None = None,
    gap_at: int | None = None,
) -> bytes:
    """Trace le long d'un méridien (≈ 111 m par point), 1 point/s, +1 m d'altitude par point."""
    ns = 'xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"'
    pts = ""
    for i in range(n):
        shift = 600 if gap_at is not None and i >= gap_at else 0  # pause de 10 minutes
        t = (START + timedelta(seconds=i + shift)).strftime("%Y-%m-%dT%H:%M:%SZ")
        pts += f'<trkpt lat="{45 + i * 0.0001:.6f}" lon="6.0">'
        pts += f"<ele>{500 + i}</ele>" if ele else ""
        pts += f"<time>{t}</time>" if time else ""
        pts += (
            f"<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{140 + i % 10}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>"
            if hr
            else ""
        )
        pts += "</trkpt>"
    kind_xml = f"<type>{kind}</type>" if kind else ""
    return f'<?xml version="1.0"?><gpx version="1.1" {ns}><trk><name>Sortie du matin</name>{kind_xml}<trkseg>{pts}</trkseg></trk></gpx>'.encode()


# --- FIT ----------------------------------------------------------------------------------------


def test_fit_import_creates_a_normalized_session_with_stream(client: TestClient) -> None:
    r = upload(client, build_fit(START, 1200), "matin.fit")
    assert r.status_code == 201
    body = r.json()
    assert body["created"] is True and body["sport"] == "trail_running"
    assert body["start_utc"] == "2026-10-10T06:00:00" and body["duration_min"] == 20
    assert (
        body["distance_km"] == pytest.approx(3.0)
        and body["dplus_m"] == 100
        and body["hr_avg"] == 150
    )
    assert body["has_stream"] is True and body["same_session_as"] == [] and body["warnings"] == []
    listed = client.get("/api/activities?limit=10").json()
    assert (
        len(listed) == 1
        and listed[0]["source"] == "import"
        and listed[0]["id"] == body["activity_id"]
    )
    detail = client.get(f"/api/activities/{body['activity_id']}").json()
    assert detail["stream"]["points_total"] == 1200 and detail["zones"][
        "hr_time_s"
    ] == pytest.approx(1200, abs=2)
    assert detail["gap_s_per_km"] is not None and detail["hr_max"] == 170
    assert detail["climbs"] is not None  # profil exploitable comme une séance de la montre


def test_fit_stream_values_are_converted(client: TestClient) -> None:
    parsed = parse_activity(build_fit(START, 100), "x.fit")
    s = parsed.samples
    assert s["t"][:3] == [0, 1, 2] and s["fc"][0] == 130 and s["fc"][-1] == 170
    assert s["altitude"][0] == pytest.approx(100, abs=0.5) and s["altitude"][-1] == pytest.approx(
        199, abs=1
    )
    assert s["speed"][5] == pytest.approx(2.5) and s["distance"][10] == pytest.approx(25)
    assert s["cadence"][0] == 160  # cadence d'une jambe × 2 : pas par minute (course à pied)


@pytest.mark.parametrize(
    ("sport", "sub_sport", "expected"),
    [
        (1, 3, "trail_running"),
        (1, 1, "treadmill_running"),
        (1, 0, "running"),
        (2, 0, "cycling"),
        (17, 0, "hiking"),
        (11, 0, "walking"),
    ],
)
def test_fit_sport_mapping(sport: int, sub_sport: int, expected: str) -> None:
    assert (
        parse_activity(build_fit(START, 30, sport=sport, sub_sport=sub_sport), "a.fit").sport
        == expected
    )


def test_fit_without_records_uses_the_session_summary_only(client: TestClient) -> None:
    r = upload(client, build_fit(START, 1800, records=False), "resume.fit")
    body = r.json()
    assert r.status_code == 201 and body["has_stream"] is False and body["duration_min"] == 30
    assert body["distance_km"] == pytest.approx(4.5)


def test_fit_without_session_derives_the_summary_from_records() -> None:
    p = parse_activity(build_fit(START, 600, session=False), "x.fit")
    assert p.duration_s == pytest.approx(599, abs=1) and p.distance_m == pytest.approx(
        2.5 * 599, abs=3
    )
    assert p.gain_m is not None and p.hr_avg is not None and p.calories is None


def test_sport_override_and_unknown_sport_warning(client: TestClient) -> None:
    r = upload(client, build_fit(START, 120, sport=99, sub_sport=0), "x.fit")
    assert r.json()["sport"] == "unknown" and "Sport non précisé" in r.json()["warnings"][0]
    r2 = upload(
        client,
        build_fit(START + timedelta(days=1), 120, sport=99, sub_sport=0),
        "y.fit",
        sport="trail_running",
    )
    assert r2.json()["sport"] == "trail_running" and r2.json()["warnings"] == []
    assert upload(client, build_fit(START, 60), "z.fit", sport="Trail Running").status_code == 422


# --- idempotence et déduplication ---------------------------------------------------------------


def test_same_file_twice_is_one_session(client: TestClient) -> None:
    data = build_fit(START, 900)
    first = upload(client, data, "a.fit").json()
    again = upload(client, data, "renommé.fit").json()
    assert (
        first["created"] is True
        and again["created"] is False
        and again["activity_id"] == first["activity_id"]
    )
    assert len(client.get("/api/activities").json()) == 1


def test_a_session_already_synced_from_garmin_is_merged(client: TestClient) -> None:
    from app.sync.service import SyncService

    service = SyncService(
        client.app.state.session_factory,  # type: ignore[attr-defined]
        {
            "garmin": FakeConnector(
                "garmin",
                activities=[
                    activity_payload(
                        "g1",
                        start="2026-10-10T06:00:10+00:00",
                        duration=1198,
                        hr_avg=None,
                        distance=None,
                        gain=None,
                    )
                ],
            )
        },
        {"garmin": FAKE_NORMALIZER},
    )
    service.run_all()
    body = upload(client, build_fit(START, 1200), "ma-sortie.fit").json()
    assert body["same_session_as"] == ["garmin"]
    listed = client.get("/api/activities").json()
    assert len(listed) == 1 and listed[0]["source"] == "garmin"  # Garmin prévaut
    assert (
        listed[0]["distance_km"] == pytest.approx(3.0) and listed[0]["hr_avg"] == 150
    )  # champs vides comblés
    assert (
        client.get(f"/api/activities/{listed[0]['id']}").json()["stream"] is not None
    )  # flux de l'import


def test_a_different_session_is_not_merged(client: TestClient) -> None:
    upload(client, build_fit(START, 1200), "a.fit")
    other = upload(client, build_fit(START + timedelta(hours=8), 1200), "b.fit").json()
    assert other["same_session_as"] == [] and len(client.get("/api/activities").json()) == 2


def test_imports_survive_a_rebuild_from_raw_payloads(client: TestClient) -> None:
    from app.imports.normalize import IMPORT_NORMALIZER
    from app.sync.service import rebuild_normalized

    upload(client, build_fit(START, 600), "a.fit")
    with client.app.state.session_factory() as s:  # type: ignore[attr-defined]
        counts = rebuild_normalized(s, {"import": IMPORT_NORMALIZER})
    assert counts["activities"] == 1 and counts["streams"] == 1 and counts["skipped"] == 0
    assert len(client.get("/api/activities").json()) == 1


# --- GPX ----------------------------------------------------------------------------------------


def test_gpx_import_with_heart_rate_extension(client: TestClient) -> None:
    body = upload(client, gpx(), "trace.gpx", sport="trail_running").json()
    assert body["sport"] == "trail_running" and body["duration_min"] == pytest.approx(119 / 60)
    assert body["distance_km"] == pytest.approx(119 * 0.011119, abs=0.01)
    assert body["dplus_m"] == pytest.approx(119, abs=8) and body["has_stream"] is True
    assert body["hr_avg"] == pytest.approx(144.5, abs=1)
    detail = client.get(f"/api/activities/{body['activity_id']}").json()
    assert detail["hr_max"] == 149 and detail["stream"]["points_total"] == 120


def test_gpx_pause_is_not_counted_as_running_time() -> None:
    p = parse_activity(gpx(n=120, gap_at=60), "x.gpx")
    assert p.duration_s == pytest.approx(118, abs=1)  # la pause de 10 min est exclue


def test_gpx_sport_from_the_type_element_name_and_default() -> None:
    assert parse_activity(gpx(kind="trail_running"), "x.gpx").sport == "trail_running"
    assert parse_activity(gpx(kind="Running"), "x.gpx").sport == "running"
    p = parse_activity(gpx(), "x.gpx")
    assert p.sport == "unknown" and any("Sport non précisé" in w for w in p.warnings)
    assert p.name == "Sortie du matin"


def test_gpx_without_elevation_warns_and_leaves_dplus_empty(client: TestClient) -> None:
    body = upload(client, gpx(ele=False, hr=False), "x.gpx").json()
    assert body["dplus_m"] is None and any("Pas d'altitude" in w for w in body["warnings"])
    assert body["hr_avg"] is None


# --- erreurs ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "name", "message"),
    [
        (b"", "x.fit", "Fichier vide"),
        (b"pas un fichier fit" * 10, "x.fit", "FIT illisible"),
        (build_fit(START, 60)[:-40], "x.fit", "FIT illisible"),  # tronqué
        (b"\x00\x01\x02 binaire", "x.bin", "Format non reconnu"),
        (b"<html></html>", "x.gpx", "n'est pas un GPX"),
        (
            b'<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY a "boom">]><gpx>&a;</gpx>',
            "x.gpx",
            "non autorisées",
        ),
        (gpx(time=False), "x.gpx", "pas d'horodatage"),
    ],
)
def test_unusable_files_are_rejected_with_a_readable_message(
    client: TestClient, data: bytes, name: str, message: str
) -> None:
    r = upload(client, data, name)
    assert r.status_code == 422 and message in r.json()["detail"]
    assert client.get("/api/activities").json() == []  # rien d'écrit


def test_corrupted_fit_crc_is_rejected() -> None:
    data = bytearray(build_fit(START, 60))
    data[30] ^= 0xFF
    with pytest.raises(ImportFailure, match="FIT illisible"):
        parse_activity(bytes(data), "x.fit")


def test_oversized_upload_is_refused(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(activity_import, "MAX_BYTES", 1000)
    r = upload(client, b"x" * 2000, "x.fit")
    assert r.status_code == 413 and "trop volumineux" in r.json()["detail"]


def test_format_is_detected_from_content_not_only_the_name() -> None:
    assert parse_activity(build_fit(START, 60), "sans-extension").format == "fit"
    assert parse_activity(gpx(), None).format == "gpx"
    assert parse_activity(gpx(), "x.txt").format == "gpx"
