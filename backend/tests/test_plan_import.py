"""Import de plan JSON : schéma, validation ligne par ligne, aperçu, idempotence, jours réalisés."""

import json
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.test_activities_api import add

TODAY = date(2026, 10, 15)
DOCS = Path(__file__).resolve().parents[2] / "docs"
SCHEMA = json.loads((DOCS / "plan-schema.json").read_text(encoding="utf-8"))
EXAMPLE = json.loads((DOCS / "plan-exemple.json").read_text(encoding="utf-8"))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(database_path=str(tmp_path / "pi.db"), scheduler_enabled=False)
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def post(client: TestClient, doc: Any, **params: Any) -> Any:
    return client.post("/api/plan/import", params=params, content=json.dumps(doc))


def planned(
    client: TestClient, start: str = "2026-09-01", end: str = "2026-12-31"
) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = client.get(f"/api/plan/sessions?from={start}&to={end}").json()
    return data


def one(**over: Any) -> dict[str, Any]:
    return {"date": "2026-11-03", "type": "footing", **over}


# --- schéma et exemple fournis ------------------------------------------------------------------


def test_example_file_validates_against_the_schema_and_imports_cleanly(client: TestClient) -> None:
    jsonschema.validate(EXAMPLE, SCHEMA)
    preview = post(client, EXAMPLE)
    assert preview.status_code == 200
    body = preview.json()
    assert body["dry_run"] is True and body["applied"] is False
    assert body["summary"]["created_days"] == 4 and body["summary"]["sessions_in_file"] == 4
    assert planned(client) == []  # aperçu : rien d'écrit
    done = post(client, EXAMPLE, dry_run="false").json()
    assert done["applied"] is True
    rows = planned(client)
    assert [r["date"] for r in rows] == ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-08"]
    assert rows[2]["zone_cible"] == "3-4" and rows[2]["dplus_cible"] == 250
    assert rows[3]["type"] == "course" and rows[3]["duree_min"] is None


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "footing"},  # date absente
        {"date": "2026-11-03"},  # type absent
        {"date": "03/11/2026", "type": "footing"},
        {"date": "2026-11-03", "type": "marathon"},
        {"date": "2026-11-03", "type": "footing", "zone_cible": "6"},
        {"date": "2026-11-03", "type": "footing", "zone_cible": 2},
        {"date": "2026-11-03", "type": "footing", "duree_min": "60"},
        {"date": "2026-11-03", "type": "footing", "duree_min": 0},
        {"date": "2026-11-03", "type": "footing", "dplus_cible": -5},
        {"date": "2026-11-03", "type": "footing", "intensite": "haute"},
    ],
)
def test_importer_and_json_schema_reject_the_same_sessions(
    client: TestClient, bad: dict[str, Any]
) -> None:
    doc = {"version": 1, "sessions": [bad]}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(doc, SCHEMA)
    r = post(client, doc, dry_run="false")
    assert r.status_code == 422 and r.json()["detail"]["errors"]
    assert planned(client) == []


def test_schema_version_and_root_keys() -> None:
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"version": 2, "sessions": [one()]}, SCHEMA)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"sessions": [one()], "extra": 1}, SCHEMA)


# --- messages d'erreur ligne par ligne ----------------------------------------------------------


def test_errors_are_listed_per_session_in_french_and_nothing_is_written(client: TestClient) -> None:
    doc = {
        "sessions": [
            one(),
            one(
                date="2026-13-40", type="fartlek", duree_min="soixante", zone_cible="5-2", plan="x"
            ),
            {"type": "footing", "dplus_cible": 99999, "titre": "x" * 200},
            "pas un objet",
        ]
    }
    r = post(client, doc, dry_run="false")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert (
        detail["message"].startswith("Le plan contient 9 erreurs") or "erreurs" in detail["message"]
    )
    by_session: dict[int | None, list[dict[str, Any]]] = {}
    for err in detail["errors"]:
        by_session.setdefault(err["session"], []).append(err)
    assert 1 not in by_session  # la séance 1 est valide
    fields2 = {e["field"] for e in by_session[2]}
    assert fields2 == {"date", "type", "duree_min", "zone_cible", "plan"}
    messages = " ".join(e["message"] for e in by_session[2])
    assert "n'est pas une date valide" in messages and "fartlek" in messages
    assert (
        "entier de minutes" in messages
        and "fourchette" in messages
        and "Champ inconnu « plan »" in messages
    )
    assert {e["field"] for e in by_session[3]} == {"date", "dplus_cible", "titre"}
    assert by_session[4][0]["message"] == "Une séance doit être un objet JSON."
    assert planned(client) == []


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ("pas du json", "n'est pas un JSON valide"),
        ({"version": 2, "sessions": [one()]}, "Version de plan non prise en charge"),
        ({"sessions": []}, "liste de séances est vide"),
        ({"sessions": "oui"}, "liste « sessions »"),
        ({"sessions": [one()], "autre": 1}, "Champ inconnu « autre »"),
        ({"sessions": [one(date="2020-01-01")]}, "trop loin"),
        ({"sessions": [one(date="2031-01-01")]}, "trop loin"),
        ({"sessions": [one(), one()]}, "en double"),
    ],
)
def test_document_level_errors(client: TestClient, payload: Any, message: str) -> None:
    r = client.post(
        "/api/plan/import", content=payload if isinstance(payload, str) else json.dumps(payload)
    )
    assert r.status_code == 422
    assert message in json.dumps(r.json()["detail"]["errors"], ensure_ascii=False)


def test_too_many_sessions_is_rejected(client: TestClient) -> None:
    sessions = [one(date=f"2026-{m:02d}-{d:02d}") for m in (11, 12) for d in range(1, 29)] * 8
    r = post(client, {"sessions": sessions})
    assert r.status_code == 422 and "limité à 400" in json.dumps(r.json(), ensure_ascii=False)


def test_bare_list_and_default_title(client: TestClient) -> None:
    r = post(client, [one(type="cotes")], dry_run="false")
    assert r.status_code == 200
    row = planned(client)[0]
    assert row["titre"] == "Côtes" and row["type_label"] == "Côtes"


# --- aperçu, remplacement, idempotence ---------------------------------------------------------


def test_import_is_idempotent_and_keeps_ids(client: TestClient) -> None:
    post(client, EXAMPLE, dry_run="false")
    first = planned(client)
    again = post(client, EXAMPLE, dry_run="false").json()
    assert again["summary"]["unchanged_days"] == 4 and again["summary"]["created_days"] == 0
    assert again["summary"]["sessions_added"] == 0 and again["applied"] is False
    assert planned(client) == first  # mêmes lignes, mêmes identifiants


def test_changed_day_is_replaced_and_preview_shows_both_sides(client: TestClient) -> None:
    post(client, {"sessions": [one(duree_min=45, titre="Ancien")]}, dry_run="false")
    new = {"sessions": [one(duree_min=60, titre="Nouveau"), one(type="renfo", titre="Gainage")]}
    preview = post(client, new).json()
    day = preview["days"][0]
    assert day["action"] == "replace"
    assert [x["titre"] for x in day["existing"]] == ["Ancien"]
    assert [x["titre"] for x in day["incoming"]] == ["Nouveau", "Gainage"]
    assert preview["summary"]["replaced_days"] == 1 and preview["summary"]["sessions_removed"] == 1
    assert [r["titre"] for r in planned(client)] == ["Ancien"]  # l'aperçu n'a rien changé
    post(client, new, dry_run="false")
    assert sorted(r["titre"] for r in planned(client)) == ["Gainage", "Nouveau"]


def test_days_outside_the_file_are_never_touched(client: TestClient) -> None:
    post(client, {"sessions": [one(date="2026-11-10", titre="Autre jour")]}, dry_run="false")
    post(client, {"sessions": [one()]}, dry_run="false")
    assert sorted(r["titre"] for r in planned(client)) == ["Autre jour", "Footing"]


# --- jours passés déjà réalisés -----------------------------------------------------------------


def seed_past(client: TestClient) -> None:
    """07/10 : footing prévu et réalisé ; 08/10 : séance prévue, manquée."""
    client.post(
        "/api/plan/sessions",
        json={"date": "2026-10-07", "titre": "Footing prévu", "type": "footing", "duree_min": 60},
    )
    client.post(
        "/api/plan/sessions",
        json={"date": "2026-10-08", "titre": "Seuil prévu", "type": "seuil", "duree_min": 60},
    )
    add(client, "done", datetime(2026, 10, 7, 6), 58, "running", 10, 50, 140)


def test_a_past_done_day_is_not_touched_without_explicit_confirmation(client: TestClient) -> None:
    seed_past(client)
    doc = {
        "sessions": [
            one(date="2026-10-07", titre="Réécrit", type="longue"),
            one(date="2026-10-08", titre="Réécrit aussi", type="footing"),
            one(),
        ]
    }
    preview = post(client, doc).json()
    actions = {d["date"]: d for d in preview["days"]}
    assert (
        actions["2026-10-07"]["action"] == "blocked"
        and "confirmation" in actions["2026-10-07"]["reason"]
    )
    assert (
        actions["2026-10-08"]["action"] == "replace"
    )  # passé mais manqué : pas de réalisé à protéger
    assert actions["2026-11-03"]["action"] == "create"
    assert preview["summary"]["blocked_days"] == 1

    applied = post(client, doc, dry_run="false").json()
    assert applied["applied"] is True
    titles = {r["date"]: r["titre"] for r in planned(client, "2026-10-01", "2026-11-30")}
    assert titles["2026-10-07"] == "Footing prévu"  # intact
    assert titles["2026-10-08"] == "Réécrit aussi" and titles["2026-11-03"] == "Footing"

    forced = post(client, doc, dry_run="false", confirm_past_done="true").json()
    assert forced["summary"]["replaced_days"] == 1 and forced["summary"]["blocked_days"] == 0
    assert {r["date"]: r["titre"] for r in planned(client, "2026-10-01", "2026-11-30")}[
        "2026-10-07"
    ] == "Réécrit"


def test_an_identical_past_done_day_is_unchanged_not_blocked(client: TestClient) -> None:
    seed_past(client)
    same = {
        "sessions": [
            {"date": "2026-10-07", "type": "footing", "titre": "Footing prévu", "duree_min": 60}
        ]
    }
    day = post(client, same).json()["days"][0]
    assert day["action"] == "unchanged"


def test_blocked_only_file_writes_nothing(client: TestClient) -> None:
    seed_past(client)
    before = planned(client, "2026-10-01", "2026-10-31")
    r = post(client, {"sessions": [one(date="2026-10-07", titre="X")]}, dry_run="false").json()
    assert r["applied"] is False and r["summary"]["blocked_days"] == 1
    assert planned(client, "2026-10-01", "2026-10-31") == before
