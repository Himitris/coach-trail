"""Lecture des tables -> métriques de phase 2 (monotonie, fatigue, renfo, objectif, nutrition)."""

from collections.abc import Sequence
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gpx import elevation_gain_loss
from app.metrics import service
from app.metrics.fatigue import FatigueReport, fatigue_report
from app.metrics.fitness import fitness_series
from app.metrics.fueling import Outing
from app.metrics.models import monday
from app.metrics.monotony import MonotonyReport, monotony_report
from app.metrics.race_goal import (
    WINDOW_DAYS,
    RaceGoalReport,
    predictions,
    recent_volume,
    tsb_projection,
)
from app.metrics.recovery import find_key
from app.metrics.strength import StrengthReport, strength_report
from app.metrics.volume import ActivityRow
from app.models import Activity, EveningEntry, FuelingEntry, Goal, RawPayload, StrengthSession
from app.plan.matching import STRENGTH_SPORTS

PREDICTION_FIELDS = ("time5K", "time10K", "timeHalfMarathon", "timeMarathon")


def monotony(
    session: Session, rows: Sequence[ActivityRow], today: date, weeks: int
) -> MonotonyReport:
    daily, first_day, _ = service.daily_loads(session, rows, today)
    return monotony_report(daily, first_day, today, today, weeks)


def fatigue(
    session: Session, rows: Sequence[ActivityRow], today: date, weeks: int
) -> FatigueReport:
    first = monday(today) - timedelta(days=7 * (weeks - 1))
    soreness = {
        e.date: e.courbatures
        for e in session.scalars(
            select(EveningEntry).where(
                EveningEntry.kind == "day",
                EveningEntry.courbatures.is_not(None),
                EveningEntry.date >= first,
            )
        )
        if e.courbatures is not None
    }
    return fatigue_report(rows, soreness, today, weeks)


def strength(
    session: Session, rows: Sequence[ActivityRow], target: int | None, today: date, weeks: int
) -> StrengthReport:
    first = monday(today) - timedelta(days=7 * (weeks - 1))
    detected = [r.day for r in rows if r.sport in STRENGTH_SPORTS and r.day >= first]
    manual = list(
        session.scalars(select(StrengthSession.date).where(StrengthSession.date >= first))
    )
    return strength_report(detected, manual, target, today, weeks)


def garmin_predictions(session: Session, today: date) -> dict[str, float | None]:
    raws = session.scalars(
        select(RawPayload)
        .where(RawPayload.type == "wellness", RawPayload.external_key <= today.isoformat())
        .order_by(RawPayload.external_key.desc())
        .limit(14)
    )
    for raw in raws:
        block = raw.payload.get("race_predictions")
        values = {key: find_key(block, key) for key in PREDICTION_FIELDS} if block else {}
        if any(v is not None for v in values.values()):
            return values
    return {}


def race_goal(
    session: Session, rows: Sequence[ActivityRow], goal: Goal, today: date
) -> RaceGoalReport:
    daily, first_day, _ = service.daily_loads(session, rows, today)
    recent_load = (
        sum(daily.get(today - timedelta(days=k), 0.0) for k in range(WINDOW_DAYS)) / WINDOW_DAYS
    )
    last = None
    if first_day is not None:
        last = fitness_series(daily, first_day, today)[-1]
    return RaceGoalReport(
        goal_id=goal.id,
        nom=goal.nom,
        date=goal.date,
        distance_km=goal.distance_km,
        dplus_m=goal.dplus_m,
        days_left=(goal.date - today).days,
        profile=goal.profil_points,
        profile_dplus_m=(
            elevation_gain_loss([p[1] for p in goal.profil_points], smooth_window=1)[0]
            if goal.profil_points and len(goal.profil_points) >= 2
            else None
        ),
        recent=recent_volume(rows, today, goal.distance_km, goal.dplus_m),
        predictions=predictions(garmin_predictions(session, today)),
        projection=tsb_projection(last, recent_load, goal.date),
    )


def fueling_outings(
    session: Session, priority: Sequence[str], tz_rows: Sequence[ActivityRow]
) -> list[Outing]:
    """Sorties (dédupliquées) avec leur saisie de nutrition éventuelle, via le groupe de séance."""
    groups = {a.id: (a.dedup_group_id or a.id) for a in session.scalars(select(Activity))}
    entries = {
        groups.get(e.activity_id, e.activity_id): e for e in session.scalars(select(FuelingEntry))
    }
    out: list[Outing] = []
    for r in tz_rows:
        e = entries.get(groups.get(r.id, r.id))
        out.append(
            Outing(
                activity_id=r.id,
                day=r.day,
                duration_s=r.duration_s,
                distance_km=r.distance_m / 1000 if r.distance_m else None,
                entry_id=e.id if e else None,
                carbs_g_per_h=e.glucides_g_par_h if e else None,
                gi_score=e.score_digestif if e else None,
                note=e.note if e else None,
            )
        )
    return out
