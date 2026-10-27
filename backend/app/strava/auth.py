"""OAuth2 Strava : jetons sur disque (0600), rafraîchissement, échange du code d'autorisation."""

import json
import logging
import os
import secrets
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

from app.logging import remember_secret
from app.sync.types import STATE_AUTH_REQUIRED, STATE_DOWN, SourceError

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"  # noqa: S105  (adresse publique, pas un secret)
TOKEN_FILE = "strava_tokens.json"  # noqa: S105
SCOPE = "read,activity:read_all"  # lecture seule
REFRESH_MARGIN_S = 120
STATE_TTL_S = 600

MSG_NOT_CONNECTED = "Strava n'est pas connecté : utiliser « Connecter Strava » dans Sources."
MSG_REFUSED = "Autorisation Strava refusée ou expirée : reconnectez Strava dans Sources."
MSG_DOWN = "Strava injoignable ou en erreur : les dernières données connues sont conservées."


class StravaAuth:
    def __init__(
        self,
        token_dir: str | Path,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        *,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._dir = Path(token_dir)
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._client = client or httpx.Client(timeout=30.0)
        self._clock = clock
        self._lock = threading.Lock()
        self._states: dict[str, float] = {}

    # --- jetons sur disque ----------------------------------------------------------------------

    @property
    def token_path(self) -> Path:
        return self._dir / TOKEN_FILE

    def connected(self) -> bool:
        return self.token_path.is_file()

    def _load(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.token_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) and data.get("refresh_token") else None

    def _save(self, data: dict[str, Any]) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._dir.chmod(0o700)
        tmp = self.token_path.with_name(TOKEN_FILE + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(
                {k: data[k] for k in ("access_token", "refresh_token", "expires_at") if k in data}
                | {"athlete_id": (data.get("athlete") or {}).get("id", data.get("athlete_id"))},
                fh,
            )
        os.replace(tmp, self.token_path)
        self.token_path.chmod(0o600)
        for key in ("access_token", "refresh_token"):
            if data.get(key):
                remember_secret(str(data[key]))

    def disconnect(self) -> None:
        self.token_path.unlink(missing_ok=True)

    # --- flux d'autorisation --------------------------------------------------------------------

    def authorize_url(self) -> tuple[str, str]:
        state = secrets.token_urlsafe(24)
        now = self._clock()
        with self._lock:
            self._states = {s: t for s, t in self._states.items() if t > now}
            self._states[state] = now + STATE_TTL_S
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": self._redirect_uri,
                "response_type": "code",
                "approval_prompt": "auto",
                "scope": SCOPE,
                "state": state,
            }
        )
        return f"{AUTHORIZE_URL}?{query}", state

    def consume_state(self, state: str) -> bool:
        """Valide et consomme le paramètre `state` (usage unique, 10 minutes)."""
        with self._lock:
            expiry = self._states.pop(state, 0.0)
        return expiry > self._clock()

    def _token_request(self, data: dict[str, str]) -> dict[str, Any]:
        try:
            response = self._client.post(
                TOKEN_URL,
                data={"client_id": self._client_id, "client_secret": self._client_secret, **data},
            )
        except httpx.HTTPError as exc:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} ({type(exc).__name__})") from None
        if response.status_code in (400, 401, 403):
            raise SourceError(STATE_AUTH_REQUIRED, MSG_REFUSED)
        if response.status_code >= 400:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} (HTTP {response.status_code})")
        body = response.json()
        if not isinstance(body, dict) or not body.get("access_token"):
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} (réponse inattendue)")
        return body

    def exchange_code(self, code: str) -> None:
        self._save(self._token_request({"code": code, "grant_type": "authorization_code"}))

    def access_token(self) -> str:
        """Jeton d'accès valide ; rafraîchi (et réécrit) s'il expire bientôt."""
        with self._lock:
            tokens = self._load()
            if tokens is None:
                raise SourceError(STATE_AUTH_REQUIRED, MSG_NOT_CONNECTED)
            if float(tokens.get("expires_at", 0)) - REFRESH_MARGIN_S > self._clock():
                remember_secret(str(tokens["access_token"]))
                return str(tokens["access_token"])
            fresh = self._token_request(
                {"grant_type": "refresh_token", "refresh_token": str(tokens["refresh_token"])}
            )
            fresh.setdefault("athlete_id", tokens.get("athlete_id"))
            self._save(fresh)
            return str(fresh["access_token"])
