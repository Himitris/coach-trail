"""Activités détectées par la montre (marche, etc.) mais non enregistrées comme séance.

Garmin signale ces mouvements dans les « événements du jour ». On garde ceux d'au moins
MIN_MOVE_MIN minutes qui ne recoupent aucune séance enregistrée : ce sont des « petites activités
en plus », affichées dans le programme et comptées à part des volumes de course.
"""

from collections.abc import Sequence
from datetime import date, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.volume import ActivityRow
from app.models import RawPayload
from app.sync.types import RAW_EVENTS, RAW_WELLNESS

MIN_MOVE_MIN = 20
OVERLAP_MARGIN = timedelta(minutes=5)

LABELS = {
    "walking": "Marche",
    "running": "Course",
    "hiking": "Randonnée",
    "cycling": "Vélo",
    "fitness_equipment": "Fitness",
}


class DetectedMovement(BaseModel):
    date: date
    start: str  # « HH:MM » (heure locale de la montre)
    type: str
    label: str
    duration_min: int


def _parse(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _overlaps(start: datetime, end: datetime, rows: Sequence[ActivityRow]) -> bool:
    for r in rows:
        r_start = r.start_utc
        r_end = r_start + timedelta(seconds=r.duration_s)
        if start < r_end + OVERLAP_MARGIN and end > r_start - OVERLAP_MARGIN:
            return True
    return False


class DaySteps(BaseModel):
    steps: int
    goal: int | None = None


def daily_steps(session: Session, start: date, end: date) -> dict[date, DaySteps]:
    """Pas du jour (résumé quotidien Garmin) ; le jour en cours est celui de la dernière synchro."""
    keys = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    rows = session.execute(
        select(RawPayload.external_key, RawPayload.payload).where(
            RawPayload.source == "garmin",
            RawPayload.type == RAW_WELLNESS,
            RawPayload.external_key.in_(keys),
        )
    )
    out: dict[date, DaySteps] = {}
    for key, payload in rows:
        summary = payload.get("summary") if isinstance(payload, dict) else None
        if not isinstance(summary, dict):
            continue
        steps, goal = summary.get("totalSteps"), summary.get("dailyStepGoal")
        if isinstance(steps, int | float) and steps > 0:
            out[date.fromisoformat(key)] = DaySteps(
                steps=round(steps), goal=round(goal) if isinstance(goal, int | float) else None
            )
    return out


def detected_movements(
    session: Session, start: date, end: date, recorded: Sequence[ActivityRow]
) -> dict[date, list[DetectedMovement]]:
    """Mouvements détectés non enregistrés, par jour (de `start` à `end` inclus)."""
    keys = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    payloads = session.scalars(
        select(RawPayload.payload).where(
            RawPayload.source == "garmin",
            RawPayload.type == RAW_EVENTS,
            RawPayload.external_key.in_(keys),
        )
    )
    out: dict[date, list[DetectedMovement]] = {}
    for payload in payloads:
        for e in payload.get("events", []):
            duration = e.get("duration")
            gmt_start = _parse(e.get("startTimestampGMT"))
            gmt_end = _parse(e.get("endTimestampGMT"))
            local = _parse(e.get("startTimestampLocal"))
            if not isinstance(duration, int | float) or duration < MIN_MOVE_MIN:
                continue
            if gmt_start is None or gmt_end is None or local is None:
                continue
            if _overlaps(gmt_start, gmt_end, recorded):
                continue
            kind = str(e.get("activityType") or "autre")
            out.setdefault(local.date(), []).append(
                DetectedMovement(
                    date=local.date(),
                    start=local.strftime("%H:%M"),
                    type=kind,
                    label=LABELS.get(kind, kind.replace("_", " ").capitalize()),
                    duration_min=round(duration),
                )
            )
    for items in out.values():
        items.sort(key=lambda m: m.start)
    return out
