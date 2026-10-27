"""Flux de séance sous-échantillonnés (un point toutes les 30–60 s) pour le fichier JSON séparé."""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session

from app.metrics.series import pace_from_speed
from app.models import ActivityStream
from app.sync.streams import decode_stream

DEFAULT_INTERVAL_S = 45
MIN_INTERVAL_S = 30
MAX_INTERVAL_S = 60


def _avg(values: Sequence[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return sum(present) / len(present) if present else None


def _round(value: float | None, digits: int = 0) -> float | None:
    return None if value is None else round(value, digits)


def downsample_stream(
    samples: Mapping[str, Sequence[float | None]], interval_s: int = DEFAULT_INTERVAL_S
) -> dict[str, list[float | None]]:
    """Un point par tranche de `interval_s` s : moyennes (FC, altitude, allure), distance en fin."""
    t = samples.get("t", [])
    n = len(t)

    def col(name: str) -> Sequence[float | None]:
        values = samples.get(name, [])
        return values if len(values) == n else [None] * n

    hr, alt, dist, speed = col("fc"), col("altitude"), col("distance"), col("speed")
    buckets: dict[int, list[int]] = {}
    for i, ti in enumerate(t):
        if ti is not None:
            buckets.setdefault(int(ti // interval_s), []).append(i)

    out: dict[str, list[float | None]] = {
        "t_s": [],
        "hr": [],
        "altitude_m": [],
        "distance_km": [],
        "pace_s_per_km": [],
    }
    for key in sorted(buckets):
        idx = buckets[key]
        first = t[idx[0]]
        last_dist = next((dist[i] for i in reversed(idx) if dist[i] is not None), None)
        out["t_s"].append(_round(first))
        out["hr"].append(_round(_avg([hr[i] for i in idx])))
        out["altitude_m"].append(_round(_avg([alt[i] for i in idx])))
        out["distance_km"].append(_round(last_dist / 1000, 2) if last_dist is not None else None)
        out["pace_s_per_km"].append(_round(pace_from_speed(_avg([speed[i] for i in idx]))))
    return out


def activity_stream(
    session: Session, activity_id: int, interval_s: int = DEFAULT_INTERVAL_S
) -> dict[str, Any] | None:
    row = session.get(ActivityStream, activity_id)
    if row is None:
        return None
    columns = downsample_stream(decode_stream(row.samples), interval_s)
    return columns if columns["t_s"] else None
