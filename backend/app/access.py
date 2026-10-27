"""Verrouillage simple, optionnel et désactivé par défaut (variable ACCESS_CODE).

L'appli n'a pas de comptes : la sécurité repose sur le réseau (Tailscale). Ce verrou ajoute, si on
le souhaite, un code partagé (cas « un autre appareil du tailnet verrait mes données »).
Une requête `/api/*` est acceptée si, au choix :
- cookie de session `ct_session` (signé HMAC, posé par `POST /api/auth/login`, HttpOnly) ;
- en-tête `X-Access-Code: <code>` ou `Authorization: Bearer <code>` (scripts, serveur MCP).

Le code n'est jamais journalisé ni stocké dans le cookie ; changer le code invalide les sessions.
Les essais sont limités (5 échecs en 5 minutes : blocage de 5 minutes).
"""

import hashlib
import hmac
import logging
import threading
import time
from collections import deque
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

logger = logging.getLogger(__name__)

COOKIE = "ct_session"
EXEMPT = ("/api/health", "/api/ping")
EXEMPT_PREFIX = "/api/auth/"
MAX_FAILURES = 5
WINDOW_S = 300
LOCKOUT_S = 300


class AccessGuard:
    def __init__(
        self, code: str, session_days: int = 30, clock: Callable[[], float] = time.time
    ) -> None:
        self._code = code.encode()
        self._clock = clock
        self._ttl = session_days * 86400
        self._key = hashlib.sha256(b"coach-trail-session:" + self._code).digest()
        self._failures: deque[float] = deque()
        self._locked_until = 0.0
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self._code)

    @property
    def max_age(self) -> int:
        return self._ttl

    def check_code(self, candidate: str) -> bool:
        return hmac.compare_digest(candidate.encode(), self._code)

    def _sign(self, expiry: int) -> str:
        return hmac.new(self._key, str(expiry).encode(), hashlib.sha256).hexdigest()

    def issue_token(self) -> str:
        expiry = int(self._clock()) + self._ttl
        return f"{expiry}.{self._sign(expiry)}"

    def check_token(self, token: str) -> bool:
        expiry_text, _, signature = token.partition(".")
        if not expiry_text.isdigit() or not signature:
            return False
        expiry = int(expiry_text)
        return hmac.compare_digest(signature, self._sign(expiry)) and expiry > self._clock()

    # --- limitation des essais ------------------------------------------------------------------

    def lockout_remaining(self) -> int:
        with self._lock:
            return (
                max(0, int(self._locked_until - self._clock()) + 1)
                if self._locked_until > self._clock()
                else 0
            )

    def record_failure(self) -> None:
        now = self._clock()
        with self._lock:
            self._failures.append(now)
            while self._failures and now - self._failures[0] > WINDOW_S:
                self._failures.popleft()
            if len(self._failures) >= MAX_FAILURES:
                self._locked_until = now + LOCKOUT_S
                self._failures.clear()
                logger.warning("Code d'accès : trop d'essais, accès bloqué %d s", LOCKOUT_S)

    def record_success(self) -> None:
        with self._lock:
            self._failures.clear()

    # --- requêtes -------------------------------------------------------------------------------

    def allows(self, headers: list[tuple[bytes, bytes]]) -> bool:
        h = {k.lower(): v for k, v in headers}
        given = h.get(b"x-access-code")
        if given is not None and self.check_code(given.decode("latin-1")):
            return True
        auth = h.get(b"authorization", b"")
        scheme, _, bearer = auth.partition(b" ")
        if scheme.lower() == b"bearer" and self.check_code(bearer.decode("latin-1").strip()):
            return True
        for part in h.get(b"cookie", b"").decode("latin-1").split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE and self.check_token(value):
                return True
        return False


Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


class AccessMiddleware:
    """Refuse (401) les requêtes `/api/*` sans code valide ; le reste (interface statique) passe."""

    def __init__(
        self, app: Callable[[Scope, Receive, Send], Awaitable[None]], guard: AccessGuard
    ) -> None:
        self.app = app
        self.guard = guard

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = str(scope.get("path", ""))
        needs_code = (
            scope["type"] == "http"
            and path.startswith("/api")
            and path not in EXEMPT
            and not path.startswith(EXEMPT_PREFIX)
        )
        if not needs_code or self.guard.allows(list(scope["headers"])):
            await self.app(scope, receive, send)
            return
        body = '{"detail":"Accès verrouillé : code requis.","locked":true}'.encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
