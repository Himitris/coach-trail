"""Intervals.icu : payload brut -> données normalisées (mêmes tables que Garmin).

Règle commune : un champ absent donne `None`, jamais une exception ni une valeur inventée.
Les champs propriétaires Garmin (Training Readiness, Body Battery, plage HRV) restent vides.
"""

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from app.sync.types import (
    NormalizedActivity,
    NormalizedStream,
    NormalizedWellness,
    SourceNormalizer,
)

logger = logging.getLogger(__name__)

# Types Intervals.icu -> vocabulaire Garmin (celui des métriques, du plan et des widgets).
SPORTS: dict[str, str] = {
    "Run": "running",
    "TrailRun": "trail_running",
    "VirtualRun": "virtual_run",
    "Walk": "walking",
    "Hike": "hiking",
    "Ride": "cycling",
    "VirtualRide": "cycling",
    "MountainBikeRide": "mountain_biking",
    "GravelRide": "gravel_cycling",
    "Swim": "lap_swimming",
    "WeightTraining": "strength_training",
    "Workout": "fitness_equipment",
    "Yoga": "yoga",
    "Pilates": "pilates",
    "HIIT": "hiit",
    "Elliptical": "elliptical",
}
# canal de sortie -> type de flux Intervals.icu
STREAM_CHANNELS = {
    "t": "time",
    "fc": "heartrate",
    "altitude": "altitude",
    "speed": "velocity_smooth",
    "distance": "distance",
    "cadence": "cadence",
}


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _int(value: Any) -> int | None:
    n = _num(value)
    return None if n is None else round(n)


def _safe[T](
    label: str, fn: Callable[[dict[str, Any]], T | None]
) -> Callable[[dict[str, Any]], T | None]:
    def wrapper(payload: dict[str, Any]) -> T | None:
        try:
            return fn(payload)
        except Exception as exc:  # une réponse inattendue ne doit jamais être fatale
            logger.warning(
                "Intervals %s : normalisation impossible (%s)", label, type(exc).__name__
            )
            return None

    return wrapper


def _parse_utc(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _sport(activity_type: Any) -> str:
    if not isinstance(activity_type, str) or not activity_type:
        return "unknown"
    return SPORTS.get(activity_type, activity_type.lower())


def _activity(payload: dict[str, Any]) -> NormalizedActivity | None:
    ext_id = payload.get("id")
    # `start_date` est en UTC ; `start_date_local` n'a pas de fuseau et ne sert pas ici.
    start = _parse_utc(payload.get("start_date"))
    # Durée : temps en mouvement (≈ temps chronomètre de la montre, pauses automatiques exclues),
    # ce qui rapproche la durée de celle de Garmin pour la déduplication (±5 %).
    duration = _num(payload.get("moving_time")) or _num(payload.get("elapsed_time"))
    if ext_id is None or start is None or not duration:
        # Activités de tiers sans données (ex. note « STRAVA activities not available via API »).
        logger.info("Intervals activité %s ignorée : début ou durée absents", ext_id)
        return None
    gear = payload.get("gear")
    gear_name = gear.get("name") if isinstance(gear, dict) else None
    return NormalizedActivity(
        external_id=str(ext_id),
        sport=_sport(payload.get("type")),
        start=start,
        duration_s=duration,
        distance_m=_num(payload.get("distance")),
        elevation_gain_m=_num(payload.get("total_elevation_gain")),
        elevation_loss_m=_num(payload.get("total_elevation_loss")),
        hr_avg=_int(payload.get("average_heartrate")),
        hr_max=_int(payload.get("max_heartrate")),
        calories=_int(payload.get("calories")),
        gear=gear_name if isinstance(gear_name, str) else None,
        is_race=payload.get("race") is True or payload.get("sub_type") == "RACE",
    )


def _stream(payload: dict[str, Any]) -> NormalizedStream | None:
    streams = payload.get("streams")
    if not isinstance(streams, dict):
        return None
    time = streams.get("time")
    length = len(time) if isinstance(time, list) else 0
    if length == 0:
        return None
    samples: dict[str, list[float | None]] = {}
    for column, key in STREAM_CHANNELS.items():
        values = streams.get(key)
        if isinstance(values, list) and len(values) == length:
            samples[column] = [_num(v) for v in values]
    return NormalizedStream(samples) if "t" in samples else None


def _wellness(payload: dict[str, Any]) -> NormalizedWellness | None:
    try:
        day = date.fromisoformat(str(payload.get("id")))
    except ValueError:
        return None
    return NormalizedWellness(
        date=day,
        hrv_nuit=_num(payload.get("hrv")),
        fc_repos=_int(payload.get("restingHR")),
        sommeil_duree_s=_int(payload.get("sleepSecs")),
        spo2=_num(payload.get("spO2")),
        poids_kg=_num(payload.get("weight")),
        # CTL/ATL d'Intervals.icu : conservés à part, jamais utilisés à la place du calcul interne.
        source_ctl=_num(payload.get("ctl")),
        source_atl=_num(payload.get("atl")),
    )


INTERVALS_NORMALIZER = SourceNormalizer(
    activity=_safe("activité", _activity),
    stream=_safe("flux", _stream),
    wellness=_safe("bien-être", _wellness),
)
