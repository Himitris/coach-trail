"""Strava : payload brut -> données normalisées (mêmes tables que Garmin, source « strava »)."""

import logging
from typing import Any

from app.intervals.normalize import SPORTS, _int, _num, _parse_utc, _safe, _stream
from app.sync.types import NormalizedActivity, NormalizedWellness, SourceNormalizer

logger = logging.getLogger(__name__)

RUN_TYPES = frozenset({"Run", "TrailRun", "VirtualRun"})
WORKOUT_RACE = 1  # Strava : workout_type 1 = course (pour la course à pied)


def _sport(payload: dict[str, Any]) -> str:
    kind = payload.get("sport_type") or payload.get("type")
    if not isinstance(kind, str) or not kind:
        return "unknown"
    return SPORTS.get(kind, kind.lower())


def _activity(payload: dict[str, Any]) -> NormalizedActivity | None:
    ext_id = payload.get("id")
    start = _parse_utc(payload.get("start_date"))
    # Temps en mouvement (comme Intervals.icu) : proche du chronomètre de la montre.
    duration = _num(payload.get("moving_time")) or _num(payload.get("elapsed_time"))
    if ext_id is None or start is None or not duration:
        logger.info("Strava activité %s ignorée : début ou durée absents", ext_id)
        return None
    gear = payload.get("gear")
    name = gear.get("name") if isinstance(gear, dict) else None
    kind = payload.get("sport_type") or payload.get("type")
    return NormalizedActivity(
        external_id=str(ext_id),
        sport=_sport(payload),
        start=start,
        duration_s=duration,
        distance_m=_num(payload.get("distance")),
        elevation_gain_m=_num(payload.get("total_elevation_gain")),
        hr_avg=_int(payload.get("average_heartrate")),
        hr_max=_int(payload.get("max_heartrate")),
        calories=_int(payload.get("calories")),
        gear=name if isinstance(name, str) else None,
        is_race=kind in RUN_TYPES and payload.get("workout_type") == WORKOUT_RACE,
    )


def _no_wellness(_: dict[str, Any]) -> NormalizedWellness | None:
    return None


STRAVA_NORMALIZER = SourceNormalizer(
    activity=_safe("activité", _activity),
    stream=_safe("flux", _stream),
    wellness=_no_wellness,
)
