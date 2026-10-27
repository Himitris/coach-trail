from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.access import COOKIE, LOCKOUT_S, MAX_FAILURES, AccessGuard
from app.config import Settings
from app.main import create_app

CODE = "sesame-2026"


def make(tmp_path: Path, code: str) -> Settings:
    from pydantic import SecretStr

    return Settings(
        database_path=str(tmp_path / "t.db"), scheduler_enabled=False, access_code=SecretStr(code)
    )


@pytest.fixture
def locked(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(make(tmp_path, CODE))) as c:
        yield c


def test_disabled_by_default(client: TestClient) -> None:
    assert client.get("/api/auth/status").json() == {"locked": False, "authenticated": True}
    assert client.get("/api/profile").status_code == 200


def test_locked_api_is_refused_without_code(locked: TestClient) -> None:
    r = locked.get("/api/profile")
    assert r.status_code == 401 and r.json()["locked"] is True
    assert locked.get("/api/health").status_code == 200  # sonde de santé exemptée
    assert locked.get("/api/auth/status").json() == {"locked": True, "authenticated": False}


def test_header_and_bearer_grant_access(locked: TestClient) -> None:
    assert locked.get("/api/profile", headers={"X-Access-Code": CODE}).status_code == 200
    assert (
        locked.get("/api/profile", headers={"Authorization": f"Bearer {CODE}"}).status_code == 200
    )
    assert locked.get("/api/profile", headers={"X-Access-Code": "faux"}).status_code == 401


def test_login_sets_httponly_cookie_then_logout(locked: TestClient) -> None:
    r = locked.post("/api/auth/login", json={"code": CODE})
    assert r.status_code == 204
    cookie = r.headers["set-cookie"].lower()
    assert COOKIE in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert CODE not in r.headers["set-cookie"]  # jamais le code en clair
    assert locked.get("/api/profile").status_code == 200
    assert locked.get("/api/auth/status").json()["authenticated"] is True
    locked.post("/api/auth/logout")
    locked.cookies.clear()
    assert locked.get("/api/profile").status_code == 401


def test_wrong_code_then_lockout(locked: TestClient) -> None:
    for _ in range(MAX_FAILURES):
        assert locked.post("/api/auth/login", json={"code": "non"}).status_code == 401
    blocked = locked.post("/api/auth/login", json={"code": CODE})  # même le bon code est refusé
    assert blocked.status_code == 429 and "minute" in blocked.json()["detail"]


def test_token_expiry_and_tampering() -> None:
    now = [1_000_000.0]
    guard = AccessGuard(CODE, session_days=1, clock=lambda: now[0])
    token = guard.issue_token()
    assert guard.check_token(token)
    assert not guard.check_token(token[:-1] + ("0" if token[-1] != "0" else "1"))
    assert not guard.check_token("999999999999.abc")
    assert not AccessGuard("autre", clock=lambda: now[0]).check_token(token)  # code changé
    now[0] += 86401
    assert not guard.check_token(token)


def test_lockout_expires() -> None:
    now = [0.0]
    guard = AccessGuard(CODE, clock=lambda: now[0])
    for _ in range(MAX_FAILURES):
        guard.record_failure()
    assert guard.lockout_remaining() > 0
    now[0] += LOCKOUT_S + 1
    assert guard.lockout_remaining() == 0


def test_code_is_masked_in_logs(tmp_path: Path) -> None:
    assert CODE in make(tmp_path, CODE).secret_values()
