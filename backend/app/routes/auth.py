"""Verrouillage simple : état, connexion par code (cookie de session), déconnexion."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.access import COOKIE, AccessGuard

router = APIRouter(prefix="/auth")


class StatusOut(BaseModel):
    locked: bool  # un code est exigé
    authenticated: bool  # la requête est déjà autorisée


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, StringConstraints(min_length=1, max_length=200)]


def _guard(request: Request) -> AccessGuard:
    guard: AccessGuard = request.app.state.access
    return guard


@router.get("/status", response_model=StatusOut)
def status(request: Request) -> StatusOut:
    guard = _guard(request)
    if not guard.enabled:
        return StatusOut(locked=False, authenticated=True)
    return StatusOut(locked=True, authenticated=guard.allows(list(request.scope["headers"])))


@router.post("/login", status_code=204)
def login(body: LoginIn, request: Request, response: Response) -> None:
    guard = _guard(request)
    if not guard.enabled:
        return
    wait = guard.lockout_remaining()
    if wait:
        raise HTTPException(
            429,
            f"Trop d'essais : réessayez dans {(wait + 59) // 60} minute(s).",
        )
    if not guard.check_code(body.code):
        guard.record_failure()
        raise HTTPException(401, "Code incorrect.")
    guard.record_success()
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(
        COOKIE,
        guard.issue_token(),
        max_age=guard.max_age,
        httponly=True,
        samesite="lax",  # « lax » : le retour de Strava (navigation) doit transporter le cookie
        secure=secure,
        path="/",
    )


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")
