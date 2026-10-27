"""Répartition de l'intensité d'après la FC des flux seconde par seconde.

Zones : planchers du profil (zone 1 à 5, Garmin). Les secondes sous le plancher de la zone 1 sont
comptées à part (index 0) et rangées dans le « bas d'intensité ». Part « bas d'intensité » =
(sous zone 1 + zone 1 + zone 2) / temps avec FC ; cible 75–80 % du temps, par semaine. Aucun
jugement à la séance : seules des agrégations hebdomadaires sont produites. Les courses sont
exclues (FC de compétition non comparable aux séances).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from pydantic import BaseModel

from app.metrics.models import Evidence, Trend, monday, trend_from_delta

TARGET_LOW_MIN_PCT = 75.0
TARGET_LOW_MAX_PCT = 80.0
MAX_GAP_S = 15.0  # un écart plus long entre deux échantillons (pause) n'est pas compté
LAST_SAMPLE_S = 1.0
DEFAULT_ZONE_PCT = (50, 60, 70, 80, 90)  # repli si les zones du profil sont inutilisables


def zone_floors_from_profile(zones: Sequence[Mapping[str, Any]] | None, fc_max: int) -> list[int]:
    """Planchers (bpm) des zones 1 à 5, depuis le profil ou, à défaut, en % de la FC max."""
    if zones:
        by_zone: dict[int, int] = {}
        for z in zones:
            zone, floor = z.get("zone"), z.get("min_bpm")
            if isinstance(zone, int) and isinstance(floor, int | float):
                by_zone[zone] = round(floor)
        floors = [by_zone.get(i) for i in range(1, 6)]
        if all(f is not None for f in floors):
            ok = [f for f in floors if f is not None]
            if all(a < b for a, b in zip(ok, ok[1:], strict=False)):
                return ok
    return [int(fc_max * p / 100 + 0.5) for p in DEFAULT_ZONE_PCT]


def classify(hr: float, floors: Sequence[int]) -> int:
    """0 = sous la zone 1 ; 1..5 = zone ; au-dessus du maximum = zone 5."""
    zone = 0
    for i, floor in enumerate(floors, start=1):
        if hr >= floor:
            zone = i
    return zone


@dataclass(frozen=True)
class ZoneTime:
    seconds: tuple[float, ...]  # 6 valeurs : [sous Z1, Z1, Z2, Z3, Z4, Z5]
    hr_time_s: float  # temps avec une FC valide
    total_s: float  # temps total échantillonné (sans les pauses)


def time_in_zones(
    t: Sequence[float | None], hr: Sequence[float | None], floors: Sequence[int]
) -> ZoneTime:
    seconds = [0.0] * 6
    total = 0.0
    hr_time = 0.0
    n = min(len(t), len(hr))
    for i in range(n):
        ti = t[i]
        if ti is None:
            continue
        nxt = t[i + 1] if i + 1 < n else None
        dt = LAST_SAMPLE_S if nxt is None else nxt - ti
        if dt <= 0:
            continue
        dt = min(dt, MAX_GAP_S)
        total += dt
        h = hr[i]
        if h is None or h <= 0:
            continue
        hr_time += dt
        seconds[classify(h, floors)] += dt
    return ZoneTime(tuple(seconds), hr_time, total)


def low_share_pct(seconds: Sequence[float]) -> float | None:
    hr_time = sum(seconds)
    if hr_time <= 0:
        return None
    return sum(seconds[:3]) / hr_time * 100


def delta_to_range(share: float | None) -> float | None:
    """0 dans la fourchette cible ; sinon écart en points au bord le plus proche (neutre)."""
    if share is None:
        return None
    if share < TARGET_LOW_MIN_PCT:
        return share - TARGET_LOW_MIN_PCT
    if share > TARGET_LOW_MAX_PCT:
        return share - TARGET_LOW_MAX_PCT
    return 0.0


@dataclass(frozen=True)
class ActivityZones:
    day: date
    is_race: bool
    zones: ZoneTime | None  # None = pas de flux FC exploitable


class IntensityWeek(BaseModel):
    week_start: date
    week_end: date
    zone_seconds: list[float]
    hr_time_s: float
    low_share_pct: float | None
    delta_to_target_pct: float | None
    activities_counted: int
    activities_without_hr_stream: int
    races_excluded: int


class IntensityReport(BaseModel):
    target_min_pct: float = TARGET_LOW_MIN_PCT
    target_max_pct: float = TARGET_LOW_MAX_PCT
    zone_floors_bpm: list[int]
    weeks: list[IntensityWeek]
    average_low_share_pct: float | None
    trend: Trend
    evidence: Evidence


def intensity_report(
    items: Sequence[ActivityZones], floors: Sequence[int], last_week_of: date, weeks: int
) -> IntensityReport:
    last_monday = monday(last_week_of)
    out: list[IntensityWeek] = []
    for k in range(weeks - 1, -1, -1):
        start = last_monday - timedelta(days=7 * k)
        end = start + timedelta(days=6)
        in_week = [a for a in items if start <= a.day <= end]
        counted = [a for a in in_week if not a.is_race and a.zones and a.zones.hr_time_s > 0]
        seconds = [sum(a.zones.seconds[i] for a in counted if a.zones) for i in range(6)]
        share = low_share_pct(seconds)
        out.append(
            IntensityWeek(
                week_start=start,
                week_end=end,
                zone_seconds=seconds,
                hr_time_s=sum(seconds),
                low_share_pct=share,
                delta_to_target_pct=delta_to_range(share),
                activities_counted=len(counted),
                activities_without_hr_stream=sum(
                    1 for a in in_week if not a.is_race and not (a.zones and a.zones.hr_time_s > 0)
                ),
                races_excluded=sum(1 for a in in_week if a.is_race),
            )
        )
    total_seconds = [sum(w.zone_seconds[i] for w in out) for i in range(6)]
    with_data = [w for w in out if w.low_share_pct is not None]
    if len(with_data) >= 2:
        prev = with_data[-2].low_share_pct or 0.0
        last = with_data[-1].low_share_pct or 0.0
        trend = trend_from_delta(
            last - prev, None, "dernière semaine vs précédente", band=2.0, use_pct=False
        )
    else:
        trend = Trend(direction="indetermine", window="dernière semaine vs précédente")
    return IntensityReport(
        zone_floors_bpm=list(floors),
        weeks=out,
        average_low_share_pct=low_share_pct(total_seconds),
        trend=trend,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Zones 1–2 Garmin = bas d'intensité ; cible 75–80 % du temps sur la semaine "
                "(approche 80/20). Repère de répartition, pas un verdict par séance. "
                "Zones du profil actuel appliquées à tout l'historique ; courses exclues."
            ),
        ),
    )
