import io
import json
import logging
import stat
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from app.config import Settings
from app.garmin import auth
from app.garmin.auth import LoginManager, login_interactive
from app.logging import JsonFormatter, SecretMaskingFilter
from app.main import create_app
from app.sync.service import SyncService
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector

PASSWORD = "Sup3r-Secret-Passw0rd!"
GOOD_CODE = "123456"


class FakeClient:
    def dump(self, path: str) -> None:
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        (d / auth.TOKEN_FILE).write_text(json.dumps({"di_token": "t", "di_refresh_token": "r"}))


class FakeGarmin:
    """Imite garminconnect.Garmin pour les deux parcours de connexion."""

    mfa = False
    error: Exception | None = None
    instances: list["FakeGarmin"] = []

    def __init__(
        self,
        email: str | None = None,
        password: str | None = None,
        return_on_mfa: bool = False,
        prompt_mfa: Callable[[], str] | None = None,
    ) -> None:
        self.email, self.password = email, password
        self.return_on_mfa, self.prompt_mfa = return_on_mfa, prompt_mfa
        self.client = FakeClient()
        FakeGarmin.instances.append(self)

    def login(self, tokenstore: str | None = None) -> tuple[Any, Any]:
        if FakeGarmin.error is not None:
            raise FakeGarmin.error
        if FakeGarmin.mfa:
            if self.return_on_mfa:
                return "needs_mfa", {"cookies": "..."}
            assert self.prompt_mfa is not None
            if self.prompt_mfa() != GOOD_CODE:
                raise GarminConnectAuthenticationError("MFA")
        if tokenstore:
            self.client.dump(tokenstore)
        return None, None

    def resume_login(self, state: Any, code: str) -> tuple[Any, Any]:
        if code != GOOD_CODE:
            raise GarminConnectAuthenticationError(f"code {code} refusé pour {PASSWORD}")
        return None, None


@pytest.fixture(autouse=True)
def _reset_fake() -> Iterator[None]:
    FakeGarmin.mfa, FakeGarmin.error, FakeGarmin.instances = False, None, []
    yield


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def manager(tmp_path: Path, **kw: Any) -> LoginManager:
    return LoginManager(tmp_path / "tokens", api_factory=FakeGarmin, **kw)


# --- CLI interactive ------------------------------------------------------------------------


def test_interactive_login_saves_tokens_0600_and_forgets_password(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth, "Garmin", FakeGarmin)
    FakeGarmin.mfa = True
    login_interactive(tmp_path / "tokens", "me@example.org", PASSWORD, lambda: GOOD_CODE)
    f = tmp_path / "tokens" / auth.TOKEN_FILE
    assert f.is_file()
    assert mode(f) == 0o600 and mode(f.parent) == 0o700
    assert PASSWORD not in f.read_text()
    assert FakeGarmin.instances[0].password is None


def test_interactive_login_wrong_mfa_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth, "Garmin", FakeGarmin)
    FakeGarmin.mfa = True
    with pytest.raises(GarminConnectAuthenticationError):
        login_interactive(tmp_path / "t", "me@example.org", PASSWORD, lambda: "000000")
    assert not (tmp_path / "t" / auth.TOKEN_FILE).exists()


# --- LoginManager (écran de reconnexion) ----------------------------------------------------


def test_login_without_mfa(tmp_path: Path) -> None:
    m = manager(tmp_path)
    out = m.start("me@example.org", PASSWORD)
    assert out.status == "ok" and out.ticket is None
    f = tmp_path / "tokens" / auth.TOKEN_FILE
    assert mode(f) == 0o600
    assert FakeGarmin.instances[0].password is None


def test_login_with_mfa_two_steps(tmp_path: Path) -> None:
    FakeGarmin.mfa = True
    m = manager(tmp_path)
    out = m.start("me@example.org", PASSWORD)
    assert out.status == "mfa_required" and out.ticket
    assert not (tmp_path / "tokens" / auth.TOKEN_FILE).exists()
    assert FakeGarmin.instances[0].password is None  # oublié dès l'étape 1
    assert m.finish(out.ticket, GOOD_CODE).status == "ok"
    assert mode(tmp_path / "tokens" / auth.TOKEN_FILE) == 0o600
    with pytest.raises(auth.LoginError) as err:  # ticket à usage unique
        m.finish(out.ticket, GOOD_CODE)
    assert err.value.status_code == 400


def test_wrong_mfa_code_and_expired_ticket(tmp_path: Path) -> None:
    FakeGarmin.mfa = True
    now = [0.0]
    m = manager(tmp_path, clock=lambda: now[0], ttl_s=60)
    t1 = m.start("a@b.c", PASSWORD).ticket
    assert t1
    with pytest.raises(auth.LoginError) as err:
        m.finish(t1, "000000")
    assert err.value.status_code == 401 and PASSWORD not in err.value.message
    t2 = m.start("a@b.c", PASSWORD).ticket
    assert t2
    now[0] = 120.0
    with pytest.raises(auth.LoginError) as err:
        m.finish(t2, GOOD_CODE)
    assert err.value.status_code == 400


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (GarminConnectAuthenticationError("bad"), 401),
        (GarminConnectTooManyRequestsError("429"), 429),
        (GarminConnectConnectionError("down"), 502),
        (RuntimeError(f"boom {PASSWORD}"), 502),
    ],
)
def test_login_errors_are_mapped_without_leaking(
    tmp_path: Path, error: Exception, code: int
) -> None:
    FakeGarmin.error = error
    with pytest.raises(auth.LoginError) as err:
        manager(tmp_path).start("a@b.c", PASSWORD)
    assert err.value.status_code == code
    assert PASSWORD not in err.value.message


def test_login_start_is_rate_limited(tmp_path: Path) -> None:
    FakeGarmin.error = GarminConnectAuthenticationError("bad")
    m = manager(tmp_path, max_starts=3)
    for _ in range(3):
        with pytest.raises(auth.LoginError) as err:
            m.start("a@b.c", PASSWORD)
        assert err.value.status_code == 401
    with pytest.raises(auth.LoginError) as err:
        m.start("a@b.c", PASSWORD)
    assert err.value.status_code == 429


# --- API + secrets --------------------------------------------------------------------------


@pytest.fixture
def api(tmp_path: Path) -> Iterator[tuple[TestClient, SyncService, Path]]:
    settings = Settings(
        database_path=str(tmp_path / "t.db"),
        garmin_token_dir=str(tmp_path / "tokens"),
        scheduler_enabled=False,
    )
    app = create_app(settings, login_manager=manager(tmp_path))
    service = SyncService(
        app.state.session_factory,
        {"garmin": FakeConnector("garmin")},
        {"garmin": FAKE_NORMALIZER},
    )
    app.state.sync_service = service
    with TestClient(app) as client:
        yield client, service, tmp_path


def test_login_endpoint_two_steps_triggers_sync(
    api: tuple[TestClient, SyncService, Path],
) -> None:
    client, service, tmp = api
    FakeGarmin.mfa = True
    r = client.post("/api/garmin/login", json={"email": "a@b.c", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["status"] == "mfa_required"
    ticket = r.json()["ticket"]

    r = client.post("/api/garmin/login", json={"ticket": ticket, "mfa_code": "000000"})
    assert r.status_code == 401

    r = client.post("/api/garmin/login", json={"email": "a@b.c", "password": PASSWORD})
    ticket = r.json()["ticket"]
    r = client.post("/api/garmin/login", json={"ticket": ticket, "mfa_code": GOOD_CODE})
    assert r.status_code == 200 and r.json() == {"status": "ok", "ticket": None}
    service.wait(5)
    assert service.last_report is not None and service.last_report.trigger == "garmin-login"
    assert (tmp / "tokens" / auth.TOKEN_FILE).is_file()


def test_login_endpoint_validation_does_not_echo_secrets(
    api: tuple[TestClient, SyncService, Path],
) -> None:
    client, _service, _tmp = api
    r = client.post("/api/garmin/login", json={"email": "a@b.c"})
    assert r.status_code == 422
    r = client.post("/api/garmin/login", json={"email": 123, "password": PASSWORD, "extra": 1})
    assert PASSWORD not in r.text
    r = client.post("/api/garmin/login", json={"email": ["x"], "password": {"p": PASSWORD}})
    assert r.status_code == 422 and PASSWORD not in r.text


def test_no_secret_in_logs_responses_or_database(
    api: tuple[TestClient, SyncService, Path],
) -> None:
    client, service, tmp = api
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(SecretMaskingFilter())
    root = logging.getLogger()
    root.addHandler(handler)
    previous = root.level
    root.setLevel(logging.DEBUG)
    bodies: list[str] = []
    try:
        for error in (
            GarminConnectAuthenticationError(f"login {PASSWORD} refused"),
            GarminConnectConnectionError(f"Login failed: {PASSWORD}"),
            RuntimeError(f"password={PASSWORD}"),
        ):
            FakeGarmin.error = error
            r = client.post("/api/garmin/login", json={"email": "a@b.c", "password": PASSWORD})
            bodies.append(r.text)
            # journalisation « maladroite » d'un appelant : le masquage dynamique la couvre
            from app.logging import mask_secret

            with mask_secret(PASSWORD):
                logging.getLogger("test").error("échec avec %s", PASSWORD, exc_info=error)
        FakeGarmin.error = None
        FakeGarmin.mfa = True
        r = client.post("/api/garmin/login", json={"email": "a@b.c", "password": PASSWORD})
        bodies.append(r.text)
        client.post("/api/garmin/login", json={"ticket": r.json()["ticket"], "mfa_code": GOOD_CODE})
        service.wait(5)
    finally:
        root.removeHandler(handler)
        root.setLevel(previous)

    assert PASSWORD not in stream.getvalue()
    assert all(PASSWORD not in b for b in bodies)
    assert PASSWORD.encode() not in (tmp / "t.db").read_bytes()
    for wal in tmp.glob("t.db-*"):
        assert PASSWORD.encode() not in wal.read_bytes()
    for f in (tmp / "tokens").rglob("*"):
        if f.is_file():
            assert PASSWORD not in f.read_text()


def test_sync_status_error_message_hides_secrets(
    api: tuple[TestClient, SyncService, Path],
) -> None:
    client, service, _ = api
    connector = service.connectors["garmin"]
    assert isinstance(connector, FakeConnector)
    connector.fail = RuntimeError(f"token={PASSWORD} rejeté")
    service.run_all()
    [src] = client.get("/api/sources/health").json()
    assert src["state"] == "down"
    assert PASSWORD not in json.dumps(src)
