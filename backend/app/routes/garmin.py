from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, SecretStr

from app.garmin.auth import LoginError, LoginManager, LoginOutcome
from app.sync.service import SyncService

router = APIRouter(prefix="/garmin")


class GarminLoginIn(BaseModel):
    """Étape 1 : email + password. Étape 2 : ticket + mfa_code. Aucun champ n'est journalisé."""

    email: str | None = None
    password: SecretStr | None = None
    ticket: str | None = None
    mfa_code: SecretStr | None = None


class GarminLoginOut(BaseModel):
    status: str  # "ok" | "mfa_required"
    ticket: str | None = None


@router.post("/login", response_model=GarminLoginOut)
def garmin_login(body: GarminLoginIn, request: Request) -> LoginOutcome:
    """Reconnexion Garmin en deux étapes ; le mot de passe n'est ni conservé ni journalisé."""
    manager: LoginManager = request.app.state.garmin_login
    try:
        if body.ticket and body.mfa_code:
            outcome = manager.finish(body.ticket, body.mfa_code.get_secret_value())
        elif body.email and body.password:
            outcome = manager.start(body.email, body.password.get_secret_value())
        else:
            raise HTTPException(
                422, "Fournir email + password, ou ticket + mfa_code (deuxième étape)."
            )
    except LoginError as err:
        raise HTTPException(err.status_code, err.message) from None
    if outcome.status == "ok":
        service: SyncService = request.app.state.sync_service
        service.start_async("garmin-login")  # rafraîchit l'état de la source tout de suite
    return outcome
