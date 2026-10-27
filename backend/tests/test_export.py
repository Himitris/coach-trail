from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.export.streams import downsample_stream
from app.main import create_app
from app.models import AthleteProfile, EveningEntry, PlannedSession, SourceStatus, WellnessDaily
from tests.test_activities_api import add, hill_stream

TODAY = date(2026, 10, 15)
SNAPSHOT = Path(__file__).parent / "fixtures" / "export_snapshot.md"
SECRET = "s3cr3t-export-canary"  # noqa: S105


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        database_path=str(tmp_path / "e.db"),
        scheduler_enabled=False,
        intervals_api_key=SecretStr(SECRET),
    )
    app = create_app(settings)
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def seed(client: TestClient) -> None:
    """Jeu fixe : sorties dont une course, 70 j de récupération, plan, saisies, source en panne."""
    run = add(client, "r1", datetime(2026, 10, 6, 6), 60, "trail_running", 10, 400, 150,
              stream=hill_stream())  # fmt: skip
    add(client, "r2", datetime(2026, 10, 9, 6), 45, "running", 8, 40, 138)
    add(client, "race", datetime(2026, 10, 11, 7), 180, "trail_running", 30, 1500, 160, race=True,
        stream=hill_stream())  # fmt: skip
    add(client, "old", datetime(2026, 9, 1, 6), 50, "running", 9, 80, 140)
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        # date fixe dans le futur : ni horloge dans le snapshot, ni avertissement de profil ancien
        profile = s.get(AthleteProfile, 1)
        assert profile is not None
        profile.updated_at = datetime(2099, 1, 1)
        for i in range(70):
            d = TODAY - timedelta(days=i)
            s.add(
                WellnessDaily(
                    date=d,
                    source="garmin",
                    hrv_nuit=60.0 - (4 if i < 7 else 0) + (i % 3),
                    fc_repos=48 + (i % 2),
                    sommeil_duree_s=7 * 3600 + (i % 4) * 600,
                    sommeil_efficacite=88.0,
                    training_readiness=62 if i == 0 else None,
                    body_battery_max=85 if i == 0 else None,
                )
            )
        s.add(
            PlannedSession(
                date=date(2026, 10, 6),
                titre="Côtes",
                type="cotes",
                duree_min=60,
                zone_cible="3-4",
                dplus_cible=400,
            )  # fmt: skip
        )
        s.add(PlannedSession(date=date(2026, 10, 8), titre="Footing", type="footing", duree_min=45))
        s.add(
            EveningEntry(
                kind="day",
                date=date(2026, 10, 12),
                courbatures=6,
                malade=True,
                note="Gorge | prise\nfroid",
                updated_at=datetime(2026, 10, 12, 21),
            )  # fmt: skip
        )
        s.add(
            EveningEntry(
                kind="session",
                date=date(2026, 10, 6),
                activity_id=run,
                rpe=7,
                updated_at=datetime(2026, 10, 6, 21),
            )  # fmt: skip
        )
        s.add(
            SourceStatus(
                source="garmin",
                state="down",
                message="Session expirée",
                unavailable_since=datetime(2026, 10, 13, 3),
            )  # fmt: skip
        )
        s.commit()


def export_md(client: TestClient, **params: str) -> str:
    resp = client.get("/api/export", params={"from": "2026-09-21", "to": "2026-10-15", **params})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    return resp.text


def test_markdown_snapshot(client: TestClient) -> None:
    seed(client)
    text = export_md(client)
    if not SNAPSHOT.exists():  # première génération : à relire puis à versionner
        SNAPSHOT.write_text(text, encoding="utf-8")
    assert text == SNAPSHOT.read_text(encoding="utf-8")


def test_markdown_content(client: TestClient) -> None:
    seed(client)
    text = export_md(client)
    for expected in (
        "## Profil athlète",
        "FC max : 195 bpm",
        "## Plan prévu vs réalisé",
        "## Récupération",
        "## Glossaire des métriques et niveau de preuve",
        "## Limites et sources",
        "non validé",
        "Source garmin indisponible depuis le 2026-10-13",
        "/api/export/streams?from=2026-09-21&to=2026-10-15",
        "malade",
    ):
        assert expected in text
    assert "ACWR" in text and "alerte de blessure" not in text.lower().replace("aucune alerte", "")
    # la course n'a pas de temps par zone, les séances normales si
    race_row = next(line for line in text.splitlines() if "(course)" in line and "Trail" in line)
    assert race_row.count("—") >= 2
    # la note de saisie reste sur une seule ligne
    assert "note : « Gorge | prise froid »" in text


def test_size_is_bounded(client: TestClient) -> None:
    for i in range(200):
        add(client, f"x{i}", datetime(2026, 4, 1, 6) + timedelta(hours=20 * i), 40)
    resp = client.get("/api/export", params={"from": "2026-01-01", "to": "2026-10-15"})
    assert resp.status_code == 200
    assert len(resp.text) < 60_000
    assert "plus anciennes non listées" in resp.text


def test_empty_base_invents_nothing(client: TestClient) -> None:
    text = export_md(client)
    assert "Aucune séance sur la période." in text
    assert "Aucune séance prévue" in text
    assert "Aucun jour déclaré malade" in text
    assert "Aucune saisie" in text
    assert "Aucune donnée de récupération reçue" in text
    data = client.get("/api/export", params={"format": "json"}).json()
    assert data["activities"] == [] and data["fitness"] is None
    assert data["recovery"]["hrv"]["recent_mean"] is None
    assert data["recovery"]["training_readiness"]["value"] is None


def test_no_secret_anywhere(client: TestClient) -> None:
    seed(client)
    for url in ("/api/export", "/api/export/streams"):
        resp = client.get(url, params={"from": "2026-09-21", "to": "2026-10-15"})
        assert SECRET not in resp.text
    assert SECRET not in client.get("/api/export", params={"format": "json"}).text


def test_scope_and_json(client: TestClient) -> None:
    seed(client)
    text = export_md(client, scope="profile,glossary")
    assert "## Profil athlète" in text and "## Glossaire" in text
    assert "## Récupération" not in text and "### Séances" not in text
    data = client.get(
        "/api/export", params={"from": "2026-09-21", "to": "2026-10-15", "format": "json"}
    ).json()
    assert data["days"] == 25 and len(data["activities"]) == 3
    assert {a["source"] for a in data["activities"]} == {"garmin"}


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-10-15", "to": "2026-10-01"},
        {"from": "2025-01-01", "to": "2026-10-15"},
        {"scope": "profile,inconnu"},
    ],
)
def test_invalid_requests(client: TestClient, params: dict[str, str]) -> None:
    assert client.get("/api/export", params=params).status_code == 422


def test_default_period_is_last_28_days(client: TestClient) -> None:
    data = client.get("/api/export", params={"format": "json"}).json()
    assert (data["start"], data["end"], data["days"]) == ("2026-09-18", "2026-10-15", 28)


def test_streams_file(client: TestClient) -> None:
    seed(client)
    resp = client.get("/api/export/streams", params={"from": "2026-10-01", "to": "2026-10-15"})
    assert resp.status_code == 200
    assert "coach-trail-flux_2026-10-01_2026-10-15.json" in resp.headers["content-disposition"]
    body = resp.json()
    assert body["interval_s"] == 45
    assert len(body["activities"]) == 2  # r2 et la course n'ont pas toutes un flux : 2 avec flux
    first = body["activities"][0]
    assert len(first["t_s"]) == len(first["hr"]) == 27  # 1200 s / 45 s
    assert first["t_s"][1] - first["t_s"][0] == 45
    assert client.get("/api/export/streams", params={"interval": 10}).status_code == 422


def test_downsample_uses_means_and_last_distance() -> None:
    out = downsample_stream(hill_stream(), 60)
    assert out["t_s"][:2] == [0, 60]
    assert out["distance_km"][0] == pytest.approx(0.15, abs=0.01)
    assert out["hr"][0] == 130
    assert downsample_stream({}) == {
        k: [] for k in ("t_s", "hr", "altitude_m", "distance_km", "pace_s_per_km")
    }


def test_activity_export(client: TestClient) -> None:
    seed(client)
    ids = [a["id"] for a in client.get("/api/activities", params={"limit": 50}).json()]
    hill = next(i for i in ids if client.get(f"/api/activities/{i}").json()["stream"])
    resp = client.get(f"/api/export/activity/{hill}")
    assert resp.status_code == 200
    assert "## Détail de séance" in resp.text and "Temps par zone de FC" in resp.text
    as_json: dict[str, Any] = client.get(
        f"/api/export/activity/{hill}", params={"format": "json"}
    ).json()
    assert len(as_json["stream"]["t_s"]) == 27
    assert client.get("/api/export/activity/99999").status_code == 404


def put_layout(client: TestClient, widgets: list[dict[str, Any]]) -> None:
    grid = [{"i": w["id"], "x": 0, "y": n * 4, "w": 6, "h": 4} for n, w in enumerate(widgets)]
    page = {"id": "p1", "title": "Accueil", "widgets": widgets, "layouts": {"lg": grid}}
    layout = {"pages": [page], "home_page_id": "p1"}
    resp = client.put("/api/layout", json={"base_revision": 0, "layout": layout})
    assert resp.status_code == 200


def test_widget_export(client: TestClient) -> None:
    seed(client)
    put_layout(
        client,
        [
            {"id": "n", "type": "note", "settings": {"text": "Bonjour"}},
            {"id": "blank", "type": "note", "settings": {}},
            {"id": "f", "type": "fitness", "settings": {"period": "13w"}},
            {"id": "i", "type": "intensity", "settings": {"period": "4w"}},
            {"id": "rc", "type": "recovery", "settings": {"baseline": "30"}},
            {"id": "ra", "type": "recent-activities", "settings": {"count": 2, "sport": "trail"}},
            {"id": "wl", "type": "week-load", "settings": {"week": "last"}},
            {"id": "wp", "type": "week-plan", "settings": {}},
            {"id": "ee", "type": "evening-entry", "settings": {"day": "today"}},
            {"id": "x", "type": "inconnu", "settings": {}},
        ],
    )

    def get(widget_id: str) -> Any:
        return client.get(f"/api/export/widget/{widget_id}")

    assert get("n").text == "## Note libre\n\nBonjour\n"
    assert "## Forme (CTL / ATL / TSB)" in get("f").text
    assert "Répartition" not in get("i").text and "### Intensités" in get("i").text
    assert "Base 30 j" in get("rc").text
    assert get("ra").text.count("(course)") == 1
    assert "### Volume" in get("wl").text
    assert "## Plan prévu vs réalisé" in get("wp").text
    for empty in ("blank", "ee", "x"):
        assert get(empty).status_code == 204
    assert get("absent").status_code == 404
