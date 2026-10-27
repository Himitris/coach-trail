"""Connecteur Garmin Connect (bibliothèque non officielle python-garminconnect).

Fragile par nature : jetons de session, protections anti-robot. Toute erreur est convertie en
SourceError (auth_required / down) ; les champs ou appels manquants donnent des avertissements.
"""

import logging
import random
import time
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from typing import Any, Protocol

from garminconnect import parse_activity_detail_metrics

from app.garmin.errors import classify, is_not_found
from app.garmin.normalize import STREAM_CHANNELS
from app.sync.types import (
    STATE_AUTH_REQUIRED,
    STATE_DOWN,
    HealthResult,
    RawRecord,
    SourceError,
)

logger = logging.getLogger(__name__)

MAX_CONSECUTIVE_FAILURES = 3
MAX_WARNINGS = 20
STREAM_KEYS = {key for keys in STREAM_CHANNELS.values() for key in keys} | {"directTimestamp"}


class GarminAPI(Protocol):
    """Sous-ensemble de garminconnect.Garmin utilisé ici (permet de tester sans réseau)."""

    def get_activities_by_date(
        self,
        startdate: str,
        enddate: str | None = None,
        activitytype: str | None = None,
        sortorder: str | None = None,
    ) -> list[dict[str, Any]]: ...
    def get_activity(self, activity_id: str) -> dict[str, Any]: ...
    def get_activity_gear(self, activity_id: str) -> Any: ...
    def get_activity_details(
        self, activity_id: str, maxchart: int = ..., maxpoly: int = ...
    ) -> dict[str, Any]: ...
    def get_user_summary(self, cdate: str) -> dict[str, Any]: ...
    def get_sleep_data(self, cdate: str) -> dict[str, Any]: ...
    def get_hrv_data(self, cdate: str) -> dict[str, Any] | None: ...
    def get_training_readiness(self, cdate: str) -> Any: ...
    def get_training_status(self, cdate: str) -> dict[str, Any]: ...
    def get_race_predictions(self) -> dict[str, Any]: ...
    def get_weigh_ins(self, startdate: str, enddate: str) -> dict[str, Any]: ...
    def get_heart_rate_zones(self) -> list[dict[str, Any]]: ...
    def get_lactate_threshold(self, *, latest: bool = ...) -> dict[str, Any]: ...


class GarminConnector:
    name = "garmin"

    def __init__(
        self,
        api_factory: Callable[[], GarminAPI],
        *,
        history_months: int = 12,
        min_delay_s: float = 1.0,
        max_delay_s: float = 3.0,
        stream_max_points: int = 20000,
        sleep: Callable[[float], None] = time.sleep,
        rng: random.Random | None = None,
        today: Callable[[], date] = date.today,
    ) -> None:
        self._api_factory = api_factory
        self._history_months = history_months
        self._delay = (min_delay_s, max_delay_s)
        self._stream_max_points = stream_max_points
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311  (délais, pas de cryptographie)
        self._today = today
        self._api: GarminAPI | None = None
        self._warnings: list[str] = []
        self._suppressed = 0
        self._consecutive_failures = 0
        self._first_call = True

    # --- interface SourceConnector ------------------------------------------------------------

    def healthcheck(self) -> HealthResult:
        """Charge la session depuis les jetons ; lève SourceError(auth_required) si refusée."""
        try:
            self._api = self._api_factory()
        except Exception as exc:
            raise classify(exc) from None
        self._warnings = []
        self._suppressed = 0
        self._consecutive_failures = 0
        self._first_call = True
        return HealthResult(ok=True)

    def pop_warnings(self) -> list[str]:
        warnings, self._warnings = self._warnings, []
        if self._suppressed:
            warnings.append(f"(+{self._suppressed} autres avertissements)")
            self._suppressed = 0
        return warnings

    def fetch_activities(self, since: datetime | None) -> Iterator[RawRecord]:
        api = self._require_api()
        start = since.date() if since else self._history_start()
        listing = self._call(
            "liste des activités",
            api.get_activities_by_date,
            start.isoformat(),
            self._today().isoformat(),
            None,  # activitytype : la bibliothèque attend ici le type, pas l'ordre de tri
            "asc",
            required=True,
        )
        for summary in listing or []:
            activity_id = summary.get("activityId")
            if activity_id is None:
                self._warn("activité sans identifiant ignorée")
                continue
            detail = self._call(
                f"détail activité {activity_id}", api.get_activity, str(activity_id)
            )
            payload: dict[str, Any] = {"summary": summary, "detail": detail}
            if self._is_run(summary):  # le matériel ne concerne que les chaussures de course
                payload["gear"] = self._call(
                    f"matériel activité {activity_id}", api.get_activity_gear, str(activity_id)
                )
            yield RawRecord(str(activity_id), payload)

    @staticmethod
    def _is_run(summary: dict[str, Any]) -> bool:
        kind = (summary.get("activityType") or {}).get("typeKey", "")
        return isinstance(kind, str) and ("run" in kind or "trail" in kind)

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None:
        api = self._require_api()
        details = self._call(
            f"flux activité {external_id}",
            api.get_activity_details,
            external_id,
            self._stream_max_points,
            0,  # pas de tracé GPS dans le brut : seuls les canaux utiles sont conservés
            required=True,
            not_found_ok=True,
        )
        if not details:
            return None
        rows = parse_activity_detail_metrics(details)
        keys = [k for k in STREAM_KEYS if any(k in row for row in rows)]
        if not rows or not keys:
            return None
        columns = {key: [row.get(key) for row in rows] for key in sorted(keys)}
        return RawRecord(external_id, {"columns": columns, "count": len(rows)})

    def fetch_wellness(self, since: date | None) -> Iterator[RawRecord]:
        api = self._require_api()
        today = self._today()
        first = since or self._history_start()
        weight = self._call("poids", api.get_weigh_ins, first.isoformat(), today.isoformat())
        day = first
        while day <= today:
            iso = day.isoformat()
            payload: dict[str, Any] = {
                "date": iso,
                "summary": self._call(f"résumé {iso}", api.get_user_summary, iso),
                "sleep": self._call(f"sommeil {iso}", api.get_sleep_data, iso),
                "hrv": self._call(f"HRV {iso}", api.get_hrv_data, iso),
                "training_readiness": self._call(
                    f"Training Readiness {iso}", api.get_training_readiness, iso
                ),
                "weight": weight,
            }
            if day == today:
                payload["training_status"] = self._call(
                    "statut d'entraînement", api.get_training_status, iso
                )
                payload["race_predictions"] = self._call(
                    "prédictions de course", api.get_race_predictions
                )
            yield RawRecord(iso, payload)
            day += timedelta(days=1)

    def fetch_profile(self) -> RawRecord | None:
        """Zones FC et seuil lactique ; sans horodatage pour que le hash ne change qu'avec eux."""
        api = self._require_api()
        zones = self._call("zones FC", api.get_heart_rate_zones)
        lactate = self._call("seuil lactique", api.get_lactate_threshold)
        if zones is None and lactate is None:
            return None
        return RawRecord("profile", {"heart_rate_zones": zones, "lactate_threshold": lactate})

    # --- interne ------------------------------------------------------------------------------

    def _require_api(self) -> GarminAPI:
        if self._api is None:
            raise SourceError(STATE_AUTH_REQUIRED, "Session Garmin non initialisée")
        return self._api

    def _history_start(self) -> date:
        return self._today() - timedelta(days=round(self._history_months * 30.44))

    def _warn(self, message: str) -> None:
        if len(self._warnings) < MAX_WARNINGS:
            self._warnings.append(message)
        else:
            self._suppressed += 1
        logger.warning("Garmin : %s", message)

    def _call(
        self,
        label: str,
        fn: Callable[..., Any],
        *args: Any,
        required: bool = False,
        not_found_ok: bool = False,
    ) -> Any:
        """Appel avec pause aléatoire. Les retries sur erreurs réseau/5xx sont ceux de la
        bibliothèque (backoff exponentiel). Auth/anti-bot (401, 403, 429) : arrêt immédiat.
        Autre échec : None + avertissement (ou SourceError si `required`)."""
        if not self._first_call:
            self._sleep(self._rng.uniform(*self._delay))
        self._first_call = False
        try:
            result = fn(*args)
        except Exception as exc:
            if not_found_ok and is_not_found(exc):
                return None
            error = classify(exc)
            if error.state == STATE_AUTH_REQUIRED:
                raise error from None
            self._consecutive_failures += 1
            if required:
                raise error from None
            self._warn(f"{label} indisponible ({type(exc).__name__})")
            if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                raise SourceError(
                    STATE_DOWN, "Garmin ne répond plus (échecs répétés) : synchronisation arrêtée."
                ) from None
            return None
        self._consecutive_failures = 0
        return result
