import re
from typing import Any

from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

from app.sync.types import STATE_AUTH_REQUIRED, STATE_DOWN, SourceError

_STATUS_RE = re.compile(r"\b(401|403|429)\b")

MSG_RECONNECT = "Session Garmin expirée ou refusée : reconnexion nécessaire."
MSG_ANTIBOT = (
    "Garmin bloque les requêtes (limite de débit ou protection anti-robot) : "
    "patientez quelques heures puis reconnectez-vous."
)
MSG_NO_TOKENS = (
    "Aucune session Garmin enregistrée : connectez-vous "
    "(écran de reconnexion ou « python -m app.cli garmin-login »)."
)
MSG_DOWN = "Garmin injoignable ou en erreur : les dernières données connues sont conservées."


def http_status(exc: BaseException) -> int | None:
    response: Any = getattr(exc, "response", None)
    code = getattr(response, "status_code", None)
    if isinstance(code, int):
        return code
    match = _STATUS_RE.search(str(exc))
    return int(match.group(1)) if match else None


def is_not_found(exc: BaseException) -> bool:
    return isinstance(exc, GarminConnectNotFoundError) or http_status(exc) == 404


def classify(exc: BaseException) -> SourceError:
    """Convertit une erreur de la bibliothèque en SourceError (jamais le texte brut, qui peut
    contenir des détails sensibles)."""
    if isinstance(exc, SourceError):
        return exc
    if isinstance(exc, GarminConnectTooManyRequestsError):
        return SourceError(STATE_AUTH_REQUIRED, MSG_ANTIBOT)
    if isinstance(exc, GarminConnectAuthenticationError):
        return SourceError(STATE_AUTH_REQUIRED, MSG_RECONNECT)
    status = http_status(exc)
    if status == 429:
        return SourceError(STATE_AUTH_REQUIRED, MSG_ANTIBOT)
    if status in (401, 403):
        return SourceError(STATE_AUTH_REQUIRED, MSG_RECONNECT)
    if isinstance(exc, GarminConnectConnectionError | OSError):
        return SourceError(STATE_DOWN, MSG_DOWN)
    return SourceError(STATE_DOWN, f"{MSG_DOWN} ({type(exc).__name__})")
