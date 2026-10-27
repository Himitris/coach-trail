"""Connecteur Strava : activités et flux (aucune donnée de récupération chez Strava).

Quotas (200 requêtes / 15 min, 2 000 / jour par défaut) : lus dans les en-têtes
`X-RateLimit-Limit` / `X-RateLimit-Usage` de chaque réponse ; l'appel suivant est ralenti dès que
l'usage dépasse la moitié d'un quota, et la synchronisation s'arrête proprement (avertissement,
reprise à la synchronisation suivante) avant d'atteindre la limite.
"""

import logging
import time
from collections.abc import Callable, Iterable
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from app.strava.auth import MSG_DOWN, MSG_REFUSED, StravaAuth
from app.sync.ratelimit import RateLimiter
from app.sync.types import (
    STATE_AUTH_REQUIRED,
    STATE_DOWN,
    HealthResult,
    RawRecord,
    SourceError,
)

logger = logging.getLogger(__name__)

API = "https://www.strava.com/api/v3"
PAGE_SIZE = 100
MAX_PAGES = 40
STREAM_KEYS = "time,heartrate,altitude,velocity_smooth,distance,cadence"
WINDOWS_S = (900, 86400)
MARGIN = 10  # on s'arrête 10 requêtes avant la limite
SOFT_RATIO = 0.5  # au-delà de la moitié d'un quota : appels espacés
SOFT_DELAY_S = 2.0
MAX_WAIT_S = 30.0  # attente maximale tolérée dans une synchronisation ; au-delà : arrêt propre
MSG_RATE = "Quota Strava dépassé : nouvel essai à la prochaine synchronisation."
WARN_QUOTA = "Quota Strava presque atteint : synchronisation interrompue, reprise à la prochaine."


class StravaConnector:
    name = "strava"

    def __init__(
        self,
        auth: StravaAuth,
        *,
        history_months: int = 12,
        client: httpx.Client | None = None,
        today: Callable[[], date] = date.today,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._auth = auth
        self._history_months = history_months
        self._client = client or httpx.Client(timeout=30.0)
        self._today = today
        self._sleep = sleep
        self._limiter = RateLimiter(WINDOWS_S, margin=MARGIN, clock=clock, sleep=sleep)
        self._warnings: list[str] = []
        self._soft = False

    def pop_warnings(self) -> list[str]:
        warnings, self._warnings = self._warnings, []
        return warnings

    # --- HTTP -----------------------------------------------------------------------------------

    def _ready(self) -> bool:
        """Attend si c'est court, ralentit si le quota se remplit ; False = arrêt propre."""
        wait = self._limiter.delay()
        if wait > MAX_WAIT_S:
            if WARN_QUOTA not in self._warnings:
                self._warnings.append(WARN_QUOTA)
            return False
        if wait > 0:
            self._sleep(wait)
        elif self._soft:
            self._sleep(SOFT_DELAY_S)
        return True

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any | None:
        """JSON, ou None pour 404 / quota (arrêt propre). Lève SourceError pour le reste."""
        if not self._ready():
            return None
        token = self._auth.access_token()
        try:
            response = self._client.get(
                f"{API}{path}", params=params, headers={"Authorization": f"Bearer {token}"}
            )
        except httpx.HTTPError as exc:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} ({type(exc).__name__})") from None
        self._limiter.update(dict(response.headers))
        self._soft = self._near_soft_limit(response.headers)
        status = response.status_code
        if status in (401, 403):
            raise SourceError(STATE_AUTH_REQUIRED, MSG_REFUSED)
        if status == 404:
            return None
        if status == 429:
            raise SourceError(STATE_DOWN, MSG_RATE)
        if status >= 400:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} (HTTP {status})")
        try:
            return response.json()
        except ValueError:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} (réponse illisible)") from None

    @staticmethod
    def _near_soft_limit(headers: Any) -> bool:
        try:
            limits = [int(x) for x in str(headers.get("x-ratelimit-limit", "")).split(",")]
            usage = [int(x) for x in str(headers.get("x-ratelimit-usage", "")).split(",")]
        except ValueError:
            return False
        return any(u >= limit * SOFT_RATIO for u, limit in zip(usage, limits, strict=False))

    # --- SourceConnector ------------------------------------------------------------------------

    def healthcheck(self) -> HealthResult:
        self._auth.access_token()  # lève SourceError si non connecté ou refusé
        return HealthResult(ok=True)

    def fetch_activities(self, since: datetime | None) -> Iterable[RawRecord]:
        start = since or datetime.combine(
            self._today() - timedelta(days=30 * self._history_months), datetime.min.time()
        )
        after = int(start.timestamp())
        for page in range(1, MAX_PAGES + 1):
            data = self._get(
                "/athlete/activities", {"after": after, "page": page, "per_page": PAGE_SIZE}
            )
            if not isinstance(data, list) or not data:
                return
            for item in data:
                if isinstance(item, dict) and item.get("id") is not None:
                    yield RawRecord(str(item["id"]), item)
            if len(data) < PAGE_SIZE:
                return

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None:
        data = self._get(
            f"/activities/{external_id}/streams", {"keys": STREAM_KEYS, "key_by_type": "true"}
        )
        if not isinstance(data, dict):
            return None
        streams = {
            str(k): v["data"]
            for k, v in data.items()
            if isinstance(v, dict) and isinstance(v.get("data"), list)
        }
        return RawRecord(external_id, {"streams": streams}) if streams else None

    def fetch_wellness(self, since: date | None) -> Iterable[RawRecord]:
        return []  # Strava ne fournit ni HRV, ni sommeil, ni FC de repos
