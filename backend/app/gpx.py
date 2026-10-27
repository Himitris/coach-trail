"""Lecture d'une trace GPX : points, profil altimétrique, distance et dénivelé.

Sécurité : un fichier GPX vient de l'extérieur. Les déclarations DOCTYPE/ENTITY (attaques par
entités XML) sont refusées avant l'analyse, la taille est bornée.
"""

import math
import re
import xml.etree.ElementTree as ET  # noqa: S405  (DOCTYPE refusé avant l'analyse)
from dataclasses import dataclass
from datetime import UTC, datetime

from app.metrics.climbs import smooth

MAX_BYTES = 5_000_000
EARTH_RADIUS_M = 6_371_008.8
ELEVATION_SMOOTH = 5
ELEVATION_HYSTERESIS_M = 3.0
MAX_PROFILE_POINTS = 300


class GpxError(ValueError):
    """Fichier GPX inutilisable (message en français)."""


@dataclass(frozen=True)
class TrackPoint:
    lat: float
    lon: float
    ele: float | None
    time: datetime | None = None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def _time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def parse_gpx(text: str | bytes) -> list[TrackPoint]:
    raw = text.encode() if isinstance(text, str) else text
    if len(raw) > MAX_BYTES:
        raise GpxError("Fichier GPX trop volumineux (5 Mo maximum).")
    if re.search(rb"<!\s*(DOCTYPE|ENTITY)", raw, re.IGNORECASE):
        raise GpxError("Fichier GPX refusé : déclarations XML non autorisées.")
    try:
        root = ET.fromstring(raw)  # noqa: S314  (DOCTYPE/ENTITY refusés ci-dessus)
    except ET.ParseError:
        raise GpxError("Fichier GPX illisible : XML invalide.") from None
    if _local(root.tag) != "gpx":
        raise GpxError("Ce fichier n'est pas un GPX (élément <gpx> absent).")
    points: list[TrackPoint] = []
    for el in root.iter():
        if _local(el.tag) not in ("trkpt", "rtept"):
            continue
        lat, lon = _float(el.get("lat")), _float(el.get("lon"))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        ele = time = None
        for child in el:
            if _local(child.tag) == "ele":
                ele = _float(child.text)
            elif _local(child.tag) == "time":
                time = _time(child.text)
        points.append(TrackPoint(lat, lon, ele, time))
    if len(points) < 2:
        raise GpxError("La trace GPX contient moins de 2 points.")
    return points


def haversine_m(a: TrackPoint, b: TrackPoint) -> float:
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dlat, dlon = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def cumulative_distance_m(points: list[TrackPoint]) -> list[float]:
    total = 0.0
    out = [0.0]
    for a, b in zip(points, points[1:], strict=False):
        total += haversine_m(a, b)
        out.append(total)
    return out


def elevation_gain_loss(
    altitudes: list[float], smooth_window: int = ELEVATION_SMOOTH
) -> tuple[float, float]:
    """(D+, D−) sur l'altitude lissée, avec hystérésis pour ignorer le bruit du capteur.

    `smooth_window=1` pour des points déjà espacés et lissés (profil saisi à la main).
    """
    alt = smooth(altitudes, smooth_window)
    gain = loss = 0.0
    ref = alt[0]
    for value in alt[1:]:
        if value - ref >= ELEVATION_HYSTERESIS_M:
            gain += value - ref
            ref = value
        elif ref - value >= ELEVATION_HYSTERESIS_M:
            loss += ref - value
            ref = value
    return gain, loss


@dataclass(frozen=True)
class TrackSummary:
    distance_km: float
    dplus_m: float | None
    dminus_m: float | None
    profile: list[tuple[float, float]]  # (km, altitude m)


def summarize(points: list[TrackPoint], max_points: int = MAX_PROFILE_POINTS) -> TrackSummary:
    dist = cumulative_distance_m(points)
    with_ele = [(d, p.ele) for d, p in zip(dist, points, strict=True) if p.ele is not None]
    km = dist[-1] / 1000
    if len(with_ele) < 2:
        return TrackSummary(km, None, None, [])
    alts = smooth([float(e) for _, e in with_ele], ELEVATION_SMOOTH)
    gain, loss = elevation_gain_loss([float(e) for _, e in with_ele])
    step = max(1, math.ceil(len(with_ele) / max_points))
    idx = list(range(0, len(with_ele), step))
    if idx[-1] != len(with_ele) - 1:
        idx.append(len(with_ele) - 1)
    profile = [(round(with_ele[i][0] / 1000, 3), round(alts[i], 1)) for i in idx]
    return TrackSummary(km, gain, loss, profile)
