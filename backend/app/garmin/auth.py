"""Authentification Garmin : jetons sur disque (0600), mot de passe jamais conservé."""

import logging
import secrets
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from app.garmin.errors import MSG_NO_TOKENS, classify
from app.logging import mask_secret
from app.sync.types import STATE_AUTH_REQUIRED, SourceError

logger = logging.getLogger(__name__)

TOKEN_FILE = "garmin_tokens.json"  # noqa: S105  (nom de fichier, pas un secret)


def tokens_present(token_dir: str | Path) -> bool:
    return (Path(token_dir) / TOKEN_FILE).is_file()


def secure_tokens(token_dir: str | Path) -> None:
    """Force 0700 sur le dossier et 0600 sur le fichier de jetons."""
    d = Path(token_dir)
    if d.is_dir():
        d.chmod(0o700)
    f = d / TOKEN_FILE
    if f.is_file():
        f.chmod(0o600)


def build_api(token_dir: str | Path) -> Garmin:
    """Client authentifié à partir des jetons enregistrés (aucun mot de passe nécessaire)."""
    if not tokens_present(token_dir):
        raise SourceError(STATE_AUTH_REQUIRED, MSG_NO_TOKENS)
    api = Garmin()
    try:
        api.login(tokenstore=str(token_dir))
    except Exception as exc:
        raise classify(exc) from None
    return api


def login_interactive(
    token_dir: str | Path, email: str, password: str, prompt_mfa: Callable[[], str]
) -> None:
    """Connexion avec saisie MFA interactive ; enregistre les jetons, oublie le mot de passe."""
    with mask_secret(password):
        api = Garmin(email=email, password=password, prompt_mfa=prompt_mfa)
        api.login(tokenstore=str(token_dir))
        api.password = None
        api.client.dump(str(token_dir))
    secure_tokens(token_dir)


class LoginError(Exception):
    """Erreur de connexion avec un code HTTP et un message sûr (sans détail de la source)."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass
class LoginOutcome:
    status: str  # "ok" | "mfa_required"
    ticket: str | None = None


@dataclass
class _Pending:
    api: Any
    client_state: Any
    created: float


class LoginManager:
    """Connexion en deux étapes pour l'écran de reconnexion.

    Étape 1 : email + mot de passe → "ok" ou "mfa_required" (+ ticket).
    Étape 2 : ticket + code MFA → "ok".
    L'état en attente (cookies de session) reste en mémoire, expire et n'est jamais persisté.
    """

    def __init__(
        self,
        token_dir: str | Path,
        *,
        api_factory: Callable[..., Any] = Garmin,
        ttl_s: float = 600,
        max_starts: int = 5,
        window_s: float = 600,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._token_dir = Path(token_dir)
        self._factory = api_factory
        self._ttl = ttl_s
        self._max_starts = max_starts
        self._window = window_s
        self._clock = clock
        self._pending: dict[str, _Pending] = {}
        self._starts: deque[float] = deque()
        self._lock = threading.Lock()

    def _purge(self, now: float) -> None:
        for key in [k for k, p in self._pending.items() if now - p.created > self._ttl]:
            del self._pending[key]
        while self._starts and now - self._starts[0] > self._window:
            self._starts.popleft()

    def start(self, email: str, password: str) -> LoginOutcome:
        with self._lock:
            now = self._clock()
            self._purge(now)
            if len(self._starts) >= self._max_starts:
                raise LoginError(
                    429, "Trop de tentatives de connexion : patientez quelques minutes."
                )
            self._starts.append(now)
        with mask_secret(password):
            try:
                api = self._factory(email=email, password=password, return_on_mfa=True)
                status, state = api.login()
                api.password = None
            except Exception as exc:
                raise self._to_login_error(exc) from None
            if status == "needs_mfa":
                ticket = secrets.token_urlsafe(24)
                with self._lock:
                    self._pending[ticket] = _Pending(api, state, self._clock())
                return LoginOutcome("mfa_required", ticket)
            self._save(api)
        return LoginOutcome("ok")

    def finish(self, ticket: str, code: str) -> LoginOutcome:
        with self._lock:
            self._purge(self._clock())
            pending = self._pending.pop(ticket, None)
        if pending is None:
            raise LoginError(400, "Demande de connexion expirée : recommencez.")
        with mask_secret(code):
            try:
                pending.api.resume_login(pending.client_state, code)
            except Exception as exc:
                raise self._to_login_error(exc, mfa=True) from None
            self._save(pending.api)
        return LoginOutcome("ok")

    def _save(self, api: Any) -> None:
        api.client.dump(str(self._token_dir))
        secure_tokens(self._token_dir)
        logger.info("Jetons Garmin enregistrés")

    @staticmethod
    def _to_login_error(exc: Exception, *, mfa: bool = False) -> LoginError:
        if isinstance(exc, GarminConnectTooManyRequestsError):
            return LoginError(429, "Garmin limite les tentatives : patientez avant de réessayer.")
        if isinstance(exc, GarminConnectAuthenticationError):
            msg = "Code MFA refusé." if mfa else "Identifiants Garmin refusés."
            return LoginError(401, msg)
        logger.warning("Échec de connexion Garmin : %s", type(exc).__name__)
        if isinstance(exc, GarminConnectConnectionError | OSError):
            return LoginError(502, "Garmin injoignable : réessayez plus tard.")
        return LoginError(502, "Échec de la connexion à Garmin.")
