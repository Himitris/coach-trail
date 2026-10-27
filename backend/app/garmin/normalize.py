"""Garmin : payload brut -> données normalisées.

Règle : un champ absent ou renommé donne `None` et un avertissement, jamais d'exception.
"""

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from app.sync.types import (
    NormalizedActivity,
    NormalizedProfile,
    NormalizedStream,
    NormalizedWellness,
    SourceNormalizer,
)

logger = logging.getLogger(__name__)

# Canaux du flux (clé Garmin -> colonne), premier présent retenu.
STREAM_CHANNELS: dict[str, tuple[str, ...]] = {
    "t": ("sumDuration",),
    "fc": ("directHeartRate",),
    "altitude": ("directElevation",),
    "speed": ("directSpeed",),
    "distance": ("sumDistance",),
    "cadence": ("directDoubleCadence", "directRunCadence", "directBikeCadence"),
}


def _dig(data: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _int(value: Any) -> int | None:
    n = _num(value)
    return None if n is None else round(n)


def _first(data: Any, *paths: tuple[str, ...]) -> Any:
    for path in paths:
        value = _dig(data, *path)
        if value is not None:
            return value
    return None


def _safe[T](
    label: str, fn: Callable[[dict[str, Any]], T | None]
) -> Callable[[dict[str, Any]], T | None]:
    def wrapper(payload: dict[str, Any]) -> T | None:
        try:
            return fn(payload)
        except Exception as exc:  # une réponse inattendue ne doit jamais être fatale
            logger.warning("Garmin %s : normalisation impossible (%s)", label, type(exc).__name__)
            return None

    return wrapper


def _parse_time(value: Any) -> datetime | None:
    """'2026-10-01 06:00:00' ou ISO 8601 (UTC supposé sans fuseau) ; ou millisecondes epoch."""
    if isinstance(value, int | float) and not isinstance(value, bool):
        return datetime.fromtimestamp(value / 1000, UTC)
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# --- activités ------------------------------------------------------------------------------


def _activity(payload: dict[str, Any]) -> NormalizedActivity | None:
    summary = payload.get("summary")
    detail = payload.get("detail")
    sources = [x for x in (summary, _dig(detail, "summaryDTO"), detail) if isinstance(x, dict)]

    def get(*keys: str) -> Any:
        for src in sources:
            for key in keys:
                if src.get(key) is not None:
                    return src[key]
        return None

    ext_id = get("activityId")
    start = _parse_time(get("startTimeGMT"))
    duration = _num(get("duration"))
    if ext_id is None or start is None or duration is None:
        logger.warning("Garmin activité : champs essentiels absents (id/début/durée), ignorée")
        return None
    sport = _first(summary, ("activityType", "typeKey")) or _first(
        detail, ("activityTypeDTO", "typeKey")
    )
    if sport is None:
        logger.warning("Garmin activité %s : type de sport absent", ext_id)
    return NormalizedActivity(
        external_id=str(ext_id),
        sport=str(sport or "unknown"),
        start=start,
        duration_s=duration,
        distance_m=_num(get("distance")),
        elevation_gain_m=_num(get("elevationGain")),
        elevation_loss_m=_num(get("elevationLoss")),
        hr_avg=_int(get("averageHR")),
        hr_max=_int(get("maxHR")),
        calories=_int(get("calories")),
    )


def _stream(payload: dict[str, Any]) -> NormalizedStream | None:
    columns = payload.get("columns")
    if not isinstance(columns, dict) or not columns:
        return None
    samples: dict[str, list[float | None]] = {}
    for name, keys in STREAM_CHANNELS.items():
        key = next((k for k in keys if isinstance(columns.get(k), list)), None)
        if key is not None:
            samples[name] = [_num(v) for v in columns[key]]
    if "t" not in samples:  # repli : horodatage en ms
        ts = columns.get("directTimestamp")
        if isinstance(ts, list) and ts and _num(ts[0]) is not None:
            t0 = float(ts[0])
            samples["t"] = [None if _num(v) is None else (float(v) - t0) / 1000 for v in ts]
    if "t" not in samples:
        logger.warning("Garmin flux : aucun canal temps, ignoré")
        return None
    n = len(samples["t"])
    samples = {k: v for k, v in samples.items() if len(v) == n}
    return NormalizedStream(samples)


# --- bien-être ------------------------------------------------------------------------------


def _readiness_score(entries: Any) -> int | None:
    if isinstance(entries, dict):
        entries = [entries]
    if not isinstance(entries, list) or not entries:
        return None
    dicts = [e for e in entries if isinstance(e, dict)]
    morning = [e for e in dicts if e.get("inputContext") == "AFTER_WAKEUP_RESET"]
    chosen = morning[-1] if morning else max(dicts, key=lambda e: str(e.get("timestampLocal")))
    return _int(chosen.get("score"))


def _weight_kg(weight: Any, day: str) -> float | None:
    if not isinstance(weight, dict):
        return None
    for entry in weight.get("dailyWeightSummaries") or []:
        if isinstance(entry, dict) and entry.get("summaryDate") == day:
            grams = _num(_dig(entry, "latestWeight", "weight"))
            if grams is not None:
                return round(grams / 1000 if grams > 300 else grams, 2)
    return None


def _wellness(payload: dict[str, Any]) -> NormalizedWellness | None:
    day_str = payload.get("date")
    try:
        day = date.fromisoformat(str(day_str))
    except ValueError:
        logger.warning("Garmin bien-être : date invalide, ignoré")
        return None
    sleep = payload.get("sleep")
    dto = _dig(sleep, "dailySleepDTO")
    if sleep and not isinstance(dto, dict):
        logger.warning("Garmin sommeil %s : dailySleepDTO absent", day_str)
    hrv = payload.get("hrv")
    summary = payload.get("summary")

    sleep_s = _int(_dig(dto, "sleepTimeSeconds"))
    start_ms = _num(_dig(dto, "sleepStartTimestampGMT"))
    end_ms = _num(_dig(dto, "sleepEndTimestampGMT"))
    efficiency: float | None = None
    if sleep_s and start_ms is not None and end_ms is not None and end_ms > start_ms:
        # Estimation : temps endormi / fenêtre de sommeil (Garmin ne fournit pas d'efficacité).
        efficiency = round(min(100.0, sleep_s / ((end_ms - start_ms) / 1000) * 100), 1)

    stress = _int(_dig(summary, "averageStressLevel"))
    result = NormalizedWellness(
        date=day,
        hrv_nuit=_num(_first(hrv, ("hrvSummary", "lastNightAvg")))
        or _num(_first(sleep, ("avgOvernightHrv",), ("dailySleepDTO", "avgSleepHRV"))),
        hrv_base_min=_num(_dig(hrv, "hrvSummary", "baseline", "balancedLow")),
        hrv_base_max=_num(_dig(hrv, "hrvSummary", "baseline", "balancedUpper")),
        fc_repos=_int(_dig(summary, "restingHeartRate")) or _int(_dig(sleep, "restingHeartRate")),
        sommeil_duree_s=sleep_s,
        sommeil_efficacite=efficiency,
        stress=stress if stress is not None and stress >= 0 else None,
        spo2=_num(_first(dto, ("averageSpO2Value",), ("avgSpO2",)))
        or _num(_dig(summary, "averageSpo2")),
        training_readiness=_readiness_score(payload.get("training_readiness")),
        body_battery_max=_int(_dig(summary, "bodyBatteryHighestValue")),
        body_battery_min=_int(_dig(summary, "bodyBatteryLowestValue")),
        poids_kg=_weight_kg(payload.get("weight"), str(day_str)),
    )
    values = [v for k, v in vars(result).items() if k != "date"]
    return result if any(v is not None for v in values) else None


# --- profil ---------------------------------------------------------------------------------


def _profile(payload: dict[str, Any]) -> NormalizedProfile | None:
    zones_raw = payload.get("heart_rate_zones")
    entry: dict[str, Any] | None = None
    if isinstance(zones_raw, list):
        entries = [e for e in zones_raw if isinstance(e, dict)]
        by_sport = {str(e.get("sport", "")).upper(): e for e in entries}
        entry = (
            by_sport.get("RUNNING") or by_sport.get("DEFAULT") or (entries[0] if entries else None)
        )

    zones: list[dict[str, Any]] | None = None
    if entry is not None:
        floors = [_int(entry.get(f"zone{i}Floor")) for i in range(1, 6)]
        top = _int(entry.get("maxHeartRateUsed"))
        if all(f is not None for f in floors) and top:
            bounds = [*floors, top]
            zones = [
                {
                    "zone": i + 1,
                    "min_bpm": bounds[i],
                    "max_bpm": bounds[i + 1],
                    "min_pct": round(100 * bounds[i] / top),  # type: ignore[operator]
                    "max_pct": round(100 * bounds[i + 1] / top),  # type: ignore[operator]
                }
                for i in range(5)
            ]
        else:
            logger.warning("Garmin zones FC : structure inattendue, zones non mises à jour")

    lactate = _int(_dig(payload, "lactate_threshold", "speed_and_heart_rate", "heartRate"))
    if lactate is None and entry is not None:
        lactate = _int(entry.get("lactateThresholdHrUsed"))
    resting = _int(entry.get("restingHrUsed")) if entry else None
    if zones is None and lactate is None and resting is None:
        return None
    return NormalizedProfile(fc_repos=resting, seuil_lactique_fc=lactate, zones=zones)


GARMIN_NORMALIZER = SourceNormalizer(
    activity=_safe("activité", _activity),
    stream=_safe("flux", _stream),
    wellness=_safe("bien-être", _wellness),
    profile=_safe("profil", _profile),
)
