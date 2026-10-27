from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.sync.service import SyncService
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector, activity_payload


@pytest.fixture
def api(tmp_path: Path) -> Iterator[tuple[TestClient, FakeConnector, SyncService]]:
    settings = Settings(database_path=str(tmp_path / "t.db"), scheduler_enabled=True)
    connector = FakeConnector("garmin", activities=[activity_payload("a1")])
    app = create_app(settings)
    service = SyncService(
        app.state.session_factory, {"garmin": connector}, {"garmin": FAKE_NORMALIZER}
    )
    app.state.sync_service = service
    with TestClient(app) as client:
        yield client, connector, service


def test_sources_health_before_and_after(
    api: tuple[TestClient, FakeConnector, SyncService],
) -> None:
    client, connector, service = api
    [src] = client.get("/api/sources/health").json()
    assert src["state"] == "jamais_synchronise"

    assert client.post("/api/sync/run").status_code == 202
    service.wait(5)
    [src] = client.get("/api/sources/health").json()
    assert src["state"] == "ok" and src["badge"] is None

    connector.fail = RuntimeError("Garmin 503")
    service.run_all()
    [src] = client.get("/api/sources/health").json()
    assert src["state"] == "down"
    assert src["badge"].startswith("Garmin indisponible depuis le ")
    assert src["last_success_at"] is not None  # on garde la dernière valeur
    assert client.get("/api/health").status_code == 200  # l'API reste debout


def test_run_conflict_and_status(api: tuple[TestClient, FakeConnector, SyncService]) -> None:
    import threading

    client, connector, service = api
    connector.gate = threading.Event()
    assert client.post("/api/sync/run").status_code == 202
    assert client.post("/api/sync/run").status_code == 409
    status = client.get("/api/sync/status").json()
    assert status["running"] is True
    assert status["nightly_time"] == "03:30"
    assert status["next_run_at"] is not None
    connector.gate.set()
    service.wait(5)
    status = client.get("/api/sync/status").json()
    assert status["running"] is False
    assert status["last_run"]["trigger"] == "manual"
    assert status["last_run"]["results"][0]["inserted"] == 1


def test_invalid_sync_time_rejected() -> None:
    with pytest.raises(ValueError):
        Settings(sync_time="25:99")
