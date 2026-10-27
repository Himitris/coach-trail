from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(database_path=str(tmp_path / "l.db"), scheduler_enabled=False)
    return TestClient(create_app(settings))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with make_client(tmp_path) as c:
        yield c


def doc(**over: Any) -> dict[str, Any]:
    page = {
        "id": "p1",
        "title": "Accueil",
        "widgets": [
            {"id": "w1", "type": "note", "settings": {"text": "bonjour"}},
            {"id": "w2", "type": "note", "settings": {}},
        ],
        "layouts": {
            "lg": [
                {"i": "w1", "x": 0, "y": 0, "w": 6, "h": 4},
                {"i": "w2", "x": 6, "y": 0, "w": 6, "h": 4},
            ],
            "sm": [
                {"i": "w1", "x": 0, "y": 0, "w": 4, "h": 3},
                {"i": "w2", "x": 0, "y": 3, "w": 4, "h": 3},
            ],
        },
    }
    return {"pages": [page], "home_page_id": "p1"} | over


def put(client: TestClient, layout: dict[str, Any], base: int = 0) -> Any:
    return client.put("/api/layout", json={"base_revision": base, "layout": layout})


def test_empty_at_first(client: TestClient) -> None:
    body = client.get("/api/layout").json()
    assert body == {"revision": 0, "layout": None, "updated_at": None}


def test_put_then_get_roundtrip(client: TestClient) -> None:
    r = put(client, doc())
    assert r.status_code == 200 and r.json()["revision"] == 1
    got = client.get("/api/layout").json()
    assert got["revision"] == 1
    assert got["layout"]["pages"][0]["widgets"][0]["settings"] == {"text": "bonjour"}
    # dispositions distinctes par point de rupture, conservées telles quelles
    layouts = got["layout"]["pages"][0]["layouts"]
    assert layouts["lg"][1]["x"] == 6 and layouts["sm"][1]["x"] == 0 and "md" not in layouts
    assert got["layout"]["home_page_id"] == "p1"


def test_revisions_increment_and_conflicts_are_detected(client: TestClient) -> None:
    assert put(client, doc(), 0).json()["revision"] == 1
    assert put(client, doc(home_page_id=None), 1).json()["revision"] == 2
    stale = put(client, doc(), 1)  # un autre appareil a déjà écrit la révision 2
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert (
        detail["current"]["revision"] == 2 and detail["current"]["layout"]["home_page_id"] is None
    )
    assert put(client, doc(), 0).status_code == 409  # création alors qu'une disposition existe
    assert put(client, doc(), 5).status_code == 409  # révision inconnue
    assert client.get("/api/layout").json()["revision"] == 2  # rien n'a été écrasé


def test_persists_across_restart(tmp_path: Path) -> None:
    with make_client(tmp_path) as c:
        assert put(c, doc()).status_code == 200
    with make_client(tmp_path) as c:  # nouveau processus, même base
        got = c.get("/api/layout").json()
        assert got["revision"] == 1 and got["layout"]["pages"][0]["title"] == "Accueil"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["pages"].append(dict(d["pages"][0])),  # id de page en double
        lambda d: d.update(home_page_id="absente"),
        lambda d: d["pages"][0]["widgets"].append(
            {"id": "w1", "type": "note"}
        ),  # id widget en double
        lambda d: d["pages"][0]["layouts"]["lg"].append(
            {"i": "fantome", "x": 0, "y": 0, "w": 1, "h": 1}
        ),
        lambda d: d["pages"][0]["layouts"]["lg"].append(
            {"i": "w1", "x": 0, "y": 9, "w": 1, "h": 1}
        ),
        lambda d: d["pages"][0]["layouts"].update(xl=[]),  # point de rupture inconnu
        lambda d: d["pages"][0]["layouts"]["lg"][0].update(w=0),
        lambda d: d["pages"][0]["layouts"]["lg"][0].update(x=-1),
        lambda d: d["pages"][0].update(title="   "),
        lambda d: d["pages"][0]["widgets"][0].update(id="a b"),  # caractères interdits
        lambda d: d["pages"][0]["widgets"][0]["settings"].update(text="x" * 25_000),
        lambda d: d["pages"][0].update(inconnu=1),
        lambda d: d.update(
            pages=[{**d["pages"][0], "id": f"p{i}"} for i in range(51)], home_page_id=None
        ),
    ],
)
def test_invalid_documents_are_rejected_and_nothing_is_stored(
    client: TestClient, mutate: Any
) -> None:
    d = doc()
    mutate(d)
    assert put(client, d).status_code == 422
    assert client.get("/api/layout").json()["revision"] == 0


def test_document_size_cap(client: TestClient) -> None:
    pages = []
    for i in range(30):
        widgets = [
            {"id": f"w{j}", "type": "note", "settings": {"text": "x" * 19_000}} for j in range(1)
        ]
        pages.append({"id": f"p{i}", "title": f"P{i}", "widgets": widgets, "layouts": {}})
    assert put(client, {"pages": pages, "home_page_id": None}).status_code == 422  # > 512 ko


def test_unlimited_page_count_within_cap_and_empty_pages(client: TestClient) -> None:
    pages = [{"id": f"p{i}", "title": f"Page {i}"} for i in range(50)]
    assert put(client, {"pages": pages, "home_page_id": "p3"}).status_code == 200
    assert put(client, {"pages": [], "home_page_id": None}, 1).status_code == 200  # tout supprimé
