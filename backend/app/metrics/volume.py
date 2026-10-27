"""Volume hebdomadaire : temps (base), distance, D+, D-, D+/km, comparaisons.

Semaines du lundi au dimanche (jour local). Les courses comptent dans le volume.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from pydantic import BaseModel

from app.metrics.models import Evidence, Trend, monday, pct_change, trend_from_delta

WEEK_RISE_REFERENCE_PCT = 10.0
TREND_BAND_PCT = 2.0


@dataclass(frozen=True)
class ActivityRow:
    id: int
    day: date  # jour local
    start_utc: datetime
    sport: str
    duration_s: float
    distance_m: float | None = None
    gain_m: float | None = None
    loss_m: float | None = None
    hr_avg: int | None = None
    hr_max: int | None = None
    is_race: bool = False


class VolumeTotals(BaseModel):
    time_s: float = 0.0
    distance_m: float = 0.0
    gain_m: float = 0.0
    loss_m: float = 0.0
    sessions: float = 0.0
    gain_per_km: float | None = None


def totals(rows: Sequence[ActivityRow], weeks: int = 1) -> VolumeTotals:
    """Somme des séances, divisée par `weeks` pour obtenir une moyenne hebdomadaire."""
    time_s = sum(r.duration_s for r in rows)
    distance = sum(r.distance_m or 0.0 for r in rows)
    gain = sum(r.gain_m or 0.0 for r in rows)
    loss = sum(r.loss_m or 0.0 for r in rows)
    return VolumeTotals(
        time_s=time_s / weeks,
        distance_m=distance / weeks,
        gain_m=gain / weeks,
        loss_m=loss / weeks,
        sessions=len(rows) / weeks,
        gain_per_km=gain / (distance / 1000) if distance > 0 else None,
    )


class WeekVolumeReport(BaseModel):
    week_start: date
    week_end: date
    complete: bool
    current: VolumeTotals
    previous: VolumeTotals
    avg_4w: VolumeTotals | None
    time_change_vs_previous_pct: float | None
    time_change_vs_avg4w_pct: float | None
    reference_rise_pct: float = WEEK_RISE_REFERENCE_PCT
    exceeds_reference: bool | None
    trend: Trend
    evidence: Evidence


def week_report(rows: Sequence[ActivityRow], week_of: date, today: date) -> WeekVolumeReport:
    start = monday(week_of)
    end = start + timedelta(days=6)

    def in_range(lo: date, hi: date) -> list[ActivityRow]:
        return [r for r in rows if lo <= r.day <= hi]

    current = totals(in_range(start, end))
    previous = totals(in_range(start - timedelta(days=7), start - timedelta(days=1)))
    four_weeks = in_range(start - timedelta(days=28), start - timedelta(days=1))
    avg_4w = totals(four_weeks, weeks=4) if four_weeks else None

    complete = end < today
    vs_prev = pct_change(current.time_s, previous.time_s if previous.sessions else None)
    vs_avg = pct_change(current.time_s, avg_4w.time_s if avg_4w else None)
    exceeds = None if (not complete or vs_prev is None) else vs_prev > WEEK_RISE_REFERENCE_PCT

    summary = (
        "Volumes mesurés par la montre. Le repère de +10 % de temps d'une semaine à l'autre est "
        "un ordre de grandeur de bon sens, pas un prédicteur de blessure."
    )
    if not complete:
        summary += " Semaine en cours : comparaison partielle."
    return WeekVolumeReport(
        week_start=start,
        week_end=end,
        complete=complete,
        current=current,
        previous=previous,
        avg_4w=avg_4w,
        time_change_vs_previous_pct=vs_prev,
        time_change_vs_avg4w_pct=vs_avg,
        exceeds_reference=exceeds,
        trend=trend_from_delta(
            current.time_s - previous.time_s if previous.sessions else None,
            vs_prev,
            "semaine vs semaine précédente",
            band=TREND_BAND_PCT,
        ),
        evidence=Evidence(level="etabli", summary=summary),
    )
