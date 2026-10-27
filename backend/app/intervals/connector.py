"""Connecteur Intervals.icu (API documentée, clé personnelle).

Authentification Basic : utilisateur littéral « API_KEY », mot de passe = la clé. La clé n'apparaît
que dans l'en-tête `Authorization` : jamais dans une URL, un message d'erreur ou un journal. Toute
erreur est convertie en `SourceError` avec un message lisible (français).
"""

import logging
from collections.abc import Callable, Iterable
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from app.sync.types import (
    STATE_AUTH_REQUIRED,
    STATE_DOWN,
    HealthResult,
    RawRecord,
    SourceError,
)

logger = logging.getLogger(__name__)

BASE_URL = "https://intervals.icu/api/v1"
TIMEOUT_S = 30.0
CALENDAR_AHEAD_DAYS = 60
STREAM_TYPES = "time,heartrate,altitude,velocity_smooth,distance,cadence"

MSG_KEY = "Clé API Intervals.icu refusée : vérifier INTERVALS_API_KEY et INTERVALS_ATHLETE_ID."
MSG_RATE = (
    "Intervals.icu limite le débit des requêtes : nouvel essai à la prochaine synchronisation."
)
MSG_DOWN = "Intervals.icu injoignable ou en erreur : les dernières données connues sont conservées."


class IntervalsConnector:
    name = "intervals"

    def __init__(
        self,
        athlete_id: str,
        api_key: str,
        *,
        history_months: int = 12,
        base_url: str = BASE_URL,
        client: httpx.Client | None = None,
        today: Callable[[], date] = date.today,
    ) -> None:
        self._athlete = athlete_id.strip()
        self._history_months = history_months
        self._today = today
        self._client = client or httpx.Client(timeout=TIMEOUT_S)
        self._base = base_url.rstrip("/")
        self._auth = httpx.BasicAuth("API_KEY", api_key)

    # --- HTTP ---------------------------------------------------------------------------------

    def _get(self, path: str, params: dict[str, str] | None = None) -> Any | None:
        """JSON de la réponse, ou None pour un 404. Lève SourceError sinon."""
        try:
            response = self._client.get(
                f"{self._base}{path}", params=params, auth=self._auth, timeout=TIMEOUT_S
            )
        except httpx.HTTPError as exc:
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} ({type(exc).__name__})") from None
        status = response.status_code
        if status in (401, 403):
            raise SourceError(STATE_AUTH_REQUIRED, MSG_KEY)
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

    def _athlete_path(self, suffix: str = "") -> str:
        return f"/athlete/{self._athlete}{suffix}"

    def _window(self, since: date | None, ahead_days: int = 1) -> dict[str, str]:
        today = self._today()
        oldest = since or today - timedelta(days=30 * self._history_months)
        return {
            "oldest": oldest.isoformat(),
            "newest": (today + timedelta(days=ahead_days)).isoformat(),
        }

    def _list(self, suffix: str, since: date | None, ahead_days: int = 1) -> list[dict[str, Any]]:
        data = self._get(self._athlete_path(suffix), self._window(since, ahead_days))
        if data is None:
            return []
        if not isinstance(data, list):
            raise SourceError(STATE_DOWN, f"{MSG_DOWN} (réponse inattendue)")
        return [item for item in data if isinstance(item, dict)]

    # --- SourceConnector ----------------------------------------------------------------------

    def healthcheck(self) -> HealthResult:
        if self._get(self._athlete_path()) is None:
            raise SourceError(
                STATE_AUTH_REQUIRED,
                "Athlète Intervals.icu introuvable : vérifier INTERVALS_ATHLETE_ID.",
            )
        return HealthResult(ok=True)

    def fetch_activities(self, since: datetime | None) -> Iterable[RawRecord]:
        for item in self._list("/activities", since.date() if since else None):
            if item.get("id") is not None:
                yield RawRecord(str(item["id"]), item)

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None:
        data = self._get(f"/activity/{external_id}/streams", {"types": STREAM_TYPES})
        if not isinstance(data, list):
            return None
        streams = {
            str(s["type"]): s["data"]
            for s in data
            if isinstance(s, dict) and s.get("type") and isinstance(s.get("data"), list)
        }
        return RawRecord(external_id, {"streams": streams}) if streams else None

    def fetch_wellness(self, since: date | None) -> Iterable[RawRecord]:
        for item in self._list("/wellness", since):
            if item.get("id") is not None:
                yield RawRecord(str(item["id"]), item)

    def fetch_calendar(self, since: date | None) -> Iterable[RawRecord]:
        """Événements du calendrier Intervals.icu : conservés bruts, le plan vit dans l'appli."""
        for item in self._list("/events", since, ahead_days=CALENDAR_AHEAD_DAYS):
            if item.get("id") is not None:
                yield RawRecord(str(item["id"]), item)
