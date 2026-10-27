"""Connexion Strava (optionnelle) : état, autorisation OAuth2, retour, déconnexion."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import Settings
from app.strava.auth import SCOPE, StravaAuth
from app.sync.registry import strava_enabled
from app.sync.types import SourceError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/strava")

TERMS_WARNING = (
    "Avant d'activer Strava, lisez les conditions de l'API Strava du 1er juin 2026 : elles "
    "interdisent l'entraînement d'IA avec les données Strava. Envoyer vos propres séances à Claude "
    "pour analyse n'est pas de l'entraînement, mais lisez le texte officiel."
)
LIMITS = (
    "Quotas par défaut : 200 requêtes / 15 min et 2 000 / jour ; l'appli ralentit avant le blocage."
)


class StravaStatus(BaseModel):
    enabled: bool  # STRAVA_ENABLED vrai ET identifiants présents
    requested: bool  # STRAVA_ENABLED vrai
    configured: bool  # STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET présents
    connected: bool
    scope: str
    redirect_uri: str
    warning: str
    limits: str


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _auth(request: Request) -> StravaAuth:
    auth: StravaAuth = request.app.state.strava_auth
    return auth


def _require_enabled(request: Request) -> None:
    settings = _settings(request)
    if not settings.strava_enabled:
        raise HTTPException(409, "Strava est désactivé (STRAVA_ENABLED=false).")
    if not strava_enabled(settings):
        raise HTTPException(409, "Strava : STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET sont requis.")


@router.get("/status", response_model=StravaStatus)
def status(request: Request) -> StravaStatus:
    settings = _settings(request)
    return StravaStatus(
        enabled=strava_enabled(settings),
        requested=settings.strava_enabled,
        configured=bool(
            settings.strava_client_id and settings.strava_client_secret.get_secret_value()
        ),
        connected=_auth(request).connected(),
        scope=SCOPE,
        redirect_uri=settings.strava_redirect_uri,
        warning=TERMS_WARNING,
        limits=LIMITS,
    )


class AuthorizeOut(BaseModel):
    url: str


@router.post("/authorize", response_model=AuthorizeOut)
def authorize(request: Request) -> AuthorizeOut:
    _require_enabled(request)
    url, _ = _auth(request).authorize_url()
    return AuthorizeOut(url=url)


@router.get("/callback")
def callback(
    request: Request,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> Response:
    """Retour de Strava dans le navigateur : échange le code, puis revient sur « Sources »."""
    _require_enabled(request)
    auth = _auth(request)
    if error or not code or not state or not auth.consume_state(state):
        return RedirectResponse("/sources?strava=refuse", status_code=303)
    try:
        auth.exchange_code(code)
    except SourceError as exc:
        logger.warning("Strava : échange du code impossible (%s)", exc.user_message)
        return RedirectResponse("/sources?strava=erreur", status_code=303)
    request.app.state.sync_service.start_async("strava-connexion")
    return RedirectResponse("/sources?strava=ok", status_code=303)


@router.post("/disconnect", status_code=204)
def disconnect(request: Request) -> Response:
    _auth(request).disconnect()
    return Response(status_code=204)
