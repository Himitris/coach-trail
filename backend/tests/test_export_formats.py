"""Exports JSON (schéma versionné) et CSV (séries) : snapshots, colonnes, sécurité des cellules."""

import csv
import io
import json
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.export.builder import EXPORT_VERSION, ExportData
from app.export.series import SERIES_NAMES, Table, to_csv, to_json
from app.main import create_app
from tests.test_activities_api import add
from tests.test_export import SECRET, seed

TODAY = date(2026, 10, 15)
FIXTURES = Path(__file__).parent / "fixtures"
DOCS = Path(__file__).resolve().parents[2] / "docs"
PERIOD = {"from": "2026-09-21", "to": "2026-10-15"}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        database_path=str(tmp_path / "f.db"),
        scheduler_enabled=False,
        intervals_api_key=SecretStr(SECRET),
    )
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def snapshot(name: str, text: str) -> None:
    path = FIXTURES / name
    if not path.exists():  # première génération : à relire puis à versionner
        path.write_text(text, encoding="utf-8")
    assert text == path.read_text(encoding="utf-8"), f"snapshot {name} différent"


def rows(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


# --- JSON -----------------------------------------------------------------------------------------


def test_json_export_snapshot_and_schema_version(client: TestClient) -> None:
    seed(client)
    r = client.get("/api/export", params={**PERIOD, "format": "json"})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    body = r.json()
    assert body["schema_version"] == EXPORT_VERSION == 1 and "version" not in body
    snapshot(
        "export_snapshot.json",
        json.dumps(body, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def test_json_export_covers_the_same_scopes_as_markdown(client: TestClient) -> None:
    seed(client)
    body = client.get("/api/export", params={**PERIOD, "format": "json"}).json()
    assert body["profile"]["fc_max"] == 195 and body["profile"]["goals"]
    assert len(body["activities"]) == 3 and body["volume"]["weeks"] and body["intensity"]["weeks"]
    assert (
        body["plan"]
        and body["recovery"]["entries"]
        and body["recovery"]["sick_days"] == ["2026-10-12"]
    )
    assert {g["key"] for g in body["glossary"]} >= {"acwr", "hrv", "monotonie", "gap"}
    assert body["limits"] and body["sources"]
    assert body["streams_url"] == "/api/export/streams?from=2026-09-21&to=2026-10-15"
    narrow = client.get(
        "/api/export", params={**PERIOD, "format": "json", "scope": "profile"}
    ).json()
    assert narrow["glossary"] == [] and narrow["activities"] == [] and narrow["recovery"] is None


def test_json_export_validates_against_its_published_schema(client: TestClient) -> None:
    seed(client)
    path = DOCS / "export-schema.json"
    generated = ExportData.model_json_schema()
    if not path.exists():
        path.write_text(
            json.dumps(generated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    published = json.loads(path.read_text(encoding="utf-8"))
    assert published == generated, "docs/export-schema.json périmé : le régénérer"
    body = client.get("/api/export", params={**PERIOD, "format": "json"}).json()
    jsonschema.validate(body, published)
    broken = {**body, "schema_version": "un"}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(broken, published)


def test_streams_stay_a_separate_attachment(client: TestClient) -> None:
    seed(client)
    body = client.get("/api/export", params={**PERIOD, "format": "json"}).json()
    assert "t_s" not in json.dumps(body)  # aucun flux dans le JSON principal
    streams = client.get(body["streams_url"]).json()
    assert streams["interval_s"] == 45 and streams["activities"]


# --- CSV ------------------------------------------------------------------------------------------


def test_csv_activities_snapshot(client: TestClient) -> None:
    seed(client)
    r = client.get("/api/export", params={**PERIOD, "format": "csv", "series": "activities"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert (
        'filename="coach-trail-activities_2026-09-21_2026-10-15.csv"'
        in r.headers["content-disposition"]
    )
    snapshot("export_activities.csv", r.text)
    table = rows(r.text)
    assert table[0][:4] == ["id", "date", "sport", "source"]
    assert [row[1] for row in table[1:]] == [
        "2026-10-06",
        "2026-10-09",
        "2026-10-11",
    ]  # dates ISO, croissantes
    race = next(row for row in table[1:] if row[4] == "1")
    assert race[12] == ""  # course : intensité non comparée, cellule vide plutôt que 0


def test_csv_load_hrv_and_wellness_snapshots(client: TestClient) -> None:
    seed(client)
    load = client.get("/api/export", params={**PERIOD, "format": "csv", "series": "load"}).text
    snapshot("export_load.csv", load)
    assert rows(load)[0] == ["date", "charge_points_fc", "ctl", "atl", "tsb"]
    assert len(rows(load)) == 1 + 25  # une ligne par jour de la période
    hrv = rows(client.get("/api/export", params={**PERIOD, "format": "csv", "series": "hrv"}).text)
    assert hrv[0] == [
        "date",
        "hrv_nuit_ms",
        "plage_reference_garmin_min_ms",
        "plage_reference_garmin_max_ms",
    ]
    assert len(hrv) == 1 + 25 and hrv[1][0] == "2026-09-21"
    wellness = client.get(
        "/api/export", params={**PERIOD, "format": "csv", "series": "wellness"}
    ).text
    snapshot("export_wellness.csv", wellness)
    assert rows(wellness)[0][0:3] == ["date", "hrv_nuit_ms", "fc_repos_bpm"]


@pytest.mark.parametrize("name", SERIES_NAMES)
def test_every_series_has_explicit_headers_and_valid_cells(client: TestClient, name: str) -> None:
    seed(client)
    r = client.get("/api/export", params={**PERIOD, "format": "csv", "series": name})
    assert r.status_code == 200
    table = rows(r.text)
    header = table[0]
    assert header and all(h == h.strip() and h and " " not in h for h in header)
    assert len(set(header)) == len(header)
    for row in table[1:]:
        assert len(row) == len(header)
        assert all(cell.lower() not in ("nan", "inf", "-inf", "none") for cell in row)
    first_col = header[0]
    if first_col in ("date", "semaine_du"):
        for row in table[1:]:
            date.fromisoformat(row[0])  # dates ISO partout


def test_csv_series_content_spot_checks(client: TestClient) -> None:
    seed(client)

    def get(name: str) -> list[list[str]]:
        r = client.get("/api/export", params={**PERIOD, "format": "csv", "series": name})
        return rows(r.text)

    plan = get("plan")
    assert (
        [r[0] for r in plan[1:]] == ["2026-10-06", "2026-10-08"]
        and plan[1][6] == "fait"
        and plan[2][6] == "manqué"
    )
    entries = get("entries")
    assert entries[0] == ["date", "rpe_seances_0_10", "courbatures_0_10", "malade", "note"]
    by_day = {r[0]: r for r in entries[1:]}
    assert by_day["2026-10-06"][1] == "7" and by_day["2026-10-12"][2:4] == ["6", "1"]
    monotony = get("monotony")
    assert monotony[0] == [
        "semaine_du",
        "charge",
        "monotonie",
        "tension",
        "charge_elevee",
        "alerte_douce",
    ]
    assert len(monotony) == 1 + 4  # 4 semaines couvrent la période


def test_csv_is_empty_but_valid_without_data(client: TestClient) -> None:
    for name in SERIES_NAMES:
        r = client.get("/api/export", params={"format": "csv", "series": name})
        assert r.status_code == 200 and rows(r.text)[0]


def test_csv_errors(client: TestClient) -> None:
    assert (
        client.get("/api/export", params={"format": "csv", "series": "inconnue"}).status_code == 422
    )
    bad = client.get(
        "/api/export", params={"format": "csv", "from": "2026-10-15", "to": "2026-10-01"}
    )
    assert bad.status_code == 422
    huge = client.get(
        "/api/export", params={"format": "csv", "from": "2024-01-01", "to": "2026-10-15"}
    )
    assert huge.status_code == 422


def test_csv_cells_cannot_inject_spreadsheet_formulas() -> None:
    table = Table(
        "t",
        ["a", "b"],
        [['=HYPERLINK("x")', "+1"], ["-2+3", "@SUM(A1)"], ["ok", 1.5], [None, float("nan")]],
        "d",
    )
    out = rows(to_csv(table))
    assert out[1] == ['\'=HYPERLINK("x")', "'+1"] and out[2] == ["'-2+3", "'@SUM(A1)"]
    assert out[3] == ["ok", "1.5"] and out[4] == ["", ""]
    assert to_json(table)["rows"][0] == {
        "a": '=HYPERLINK("x")',
        "b": "+1",
    }  # le JSON garde la valeur


def test_csv_text_with_commas_and_quotes_roundtrips(client: TestClient) -> None:
    add(client, "x", datetime(2026, 10, 10, 6), 60, "trail_running", 10, 400, 140)
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    from app.models import EveningEntry

    with factory() as s:
        s.add(
            EveningEntry(
                kind="day",
                date=date(2026, 10, 10),
                note='lourd, "vraiment"\nsur 2 lignes',
                updated_at=datetime(2026, 10, 10),
            )
        )
        s.commit()
    text = client.get("/api/export", params={**PERIOD, "format": "csv", "series": "entries"}).text
    assert rows(text)[1][4] == 'lourd, "vraiment"\nsur 2 lignes'


def test_no_secret_in_any_format(client: TestClient) -> None:
    seed(client)
    for fmt in ("md", "json"):
        assert SECRET not in client.get("/api/export", params={**PERIOD, "format": fmt}).text
    for name in SERIES_NAMES:
        assert (
            SECRET
            not in client.get(
                "/api/export", params={**PERIOD, "format": "csv", "series": name}
            ).text
        )


# --- widgets --------------------------------------------------------------------------------------


def put_layout(client: TestClient, widgets: list[dict[str, Any]]) -> None:
    grid = [{"i": w["id"], "x": 0, "y": n * 4, "w": 6, "h": 4} for n, w in enumerate(widgets)]
    page = {"id": "p1", "title": "Accueil", "widgets": widgets, "layouts": {"lg": grid}}
    client.put(
        "/api/layout", json={"base_revision": 0, "layout": {"pages": [page], "home_page_id": "p1"}}
    )


def test_widget_json_and_csv_exports(client: TestClient) -> None:
    seed(client)
    put_layout(
        client,
        [
            {"id": "f", "type": "fitness", "settings": {"period": "13w"}},
            {"id": "r", "type": "recovery", "settings": {"window": "14"}},
            {"id": "ra", "type": "recent-activities", "settings": {"count": 2, "sport": "all"}},
            {"id": "n", "type": "note", "settings": {"text": "x"}},
            {"id": "rg", "type": "race-goal", "settings": {}},
            {"id": "m", "type": "monotony", "settings": {"weeks": "8"}},
        ],
    )
    csv_fit = client.get("/api/export/widget/f?format=csv")
    assert csv_fit.status_code == 200 and rows(csv_fit.text)[0] == [
        "date",
        "charge_points_fc",
        "ctl",
        "atl",
        "tsb",
    ]
    assert len(rows(csv_fit.text)) == 1 + 13 * 7 + 1
    js = client.get("/api/export/widget/r?format=json").json()
    assert js["schema_version"] == 1 and js["widget"] == "recovery" and js["series"] == "wellness"
    assert js["columns"][0] == "date" and len(js["rows"]) == 14
    assert js["rows"][0]["hrv_nuit_ms"] is not None
    ra = rows(client.get("/api/export/widget/ra?format=csv").text)
    assert len(ra) == 1 + 2 and ra[1][1] <= ra[2][1]  # les 2 dernières sorties, dates croissantes
    assert len(rows(client.get("/api/export/widget/m?format=csv").text)) == 1 + 8
    for unsupported in ("n", "rg"):
        r = client.get(f"/api/export/widget/{unsupported}?format=csv")
        assert r.status_code == 422 and "pas de série" in r.json()["detail"]
    assert client.get("/api/export/widget/absent?format=json").status_code == 404
    assert client.get("/api/export/widget/f").headers["content-type"].startswith("text/markdown")
