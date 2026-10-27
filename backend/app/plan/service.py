"""Programme : lecture/écriture des séances prévues et vue de la semaine (prévu vs réalisé)."""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.models import monday
from app.metrics.service import load_rows
from app.metrics.volume import ActivityRow
from app.models import Goal, Plan, PlannedSession
from app.plan.entries import read_entries
from app.plan.matching import (
    A_VENIR,
    DayMatch,
    PlannedRow,
    SessionResult,
    match_day,
)
from app.plan.schemas import (
    TYPE_LABELS,
    WEEKDAYS_FR,
    ActivityBrief,
    DayPlanOut,
    EntryOut,
    PlanBriefOut,
    PlannedIn,
    PlannedOut,
    RaceMarkerOut,
    RangePlanOut,
    SessionMatchOut,
    WeekPlanOut,
)


def brief(row: ActivityRow) -> ActivityBrief:
    return ActivityBrief(
        id=row.id,
        sport=row.sport,
        start_utc=row.start_utc,
        duration_min=row.duration_s / 60,
        distance_km=row.distance_m / 1000 if row.distance_m is not None else None,
        dplus_m=row.gain_m,
        hr_avg=row.hr_avg,
        is_race=row.is_race,
    )


def to_row(p: PlannedSession) -> PlannedRow:
    return PlannedRow(id=p.id, type=p.type, duree_min=p.duree_min, dplus_cible=p.dplus_cible)


def planned_out(p: PlannedSession, status: str) -> PlannedOut:
    return PlannedOut(
        id=p.id,
        date=p.date,
        titre=p.titre,
        type=p.type,
        objectif=p.objectif,
        duree_min=p.duree_min,
        zone_cible=p.zone_cible,
        dplus_cible=p.dplus_cible,
        consignes=p.consignes,
        type_label=TYPE_LABELS.get(p.type, p.type),
        status=status,
        plan_id=p.plan_id,
        plan_nom=p.plan.nom if p.plan else None,
    )


def apply_fields(p: PlannedSession, body: PlannedIn) -> None:
    p.date = body.date
    p.titre = body.titre
    p.type = body.type
    p.objectif = body.objectif or None
    p.duree_min = body.duree_min
    p.zone_cible = body.zone_cible
    p.dplus_cible = body.dplus_cible
    p.consignes = body.consignes or None


def _by_day(rows: Sequence[ActivityRow]) -> dict[date, list[ActivityRow]]:
    grouped: dict[date, list[ActivityRow]] = defaultdict(list)
    for r in rows:
        grouped[r.day].append(r)
    return grouped


def match_planned(
    session: Session,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
    planned: Sequence[PlannedSession],
) -> dict[date, DayMatch]:
    """Rapprochement jour par jour pour les dates des séances données."""
    days = {p.date for p in planned}
    if not days:
        return {}
    done = _by_day([r for r in load_rows(session, priority, tz) if r.day in days])
    return {
        day: match_day(day, [to_row(p) for p in planned if p.date == day], done.get(day, []), today)
        for day in days
    }


def status_by_id(matches: dict[date, DayMatch]) -> dict[int, SessionResult]:
    return {r.planned_id: r for m in matches.values() for r in m.results}


def with_status(
    session: Session,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
    planned: Sequence[PlannedSession],
) -> list[PlannedOut]:
    results = status_by_id(match_planned(session, priority, tz, today, planned))
    return [planned_out(p, results[p.id].status if p.id in results else A_VENIR) for p in planned]


def _days(
    session: Session,
    priority: Sequence[str],
    tz: ZoneInfo,
    start: date,
    end: date,
    today: date,
) -> tuple[list[DayPlanOut], list[PlannedSession], list[ActivityRow]]:
    planned = list(
        session.scalars(
            select(PlannedSession)
            .where(PlannedSession.date >= start, PlannedSession.date <= end)
            .order_by(PlannedSession.date, PlannedSession.id)
        )
    )
    rows = [r for r in load_rows(session, priority, tz) if start <= r.day <= end]
    done = _by_day(rows)
    entries: dict[date, EntryOut] = {e.date: e for e in read_entries(session, start, end)}
    by_id = {p.id: p for p in planned}

    days: list[DayPlanOut] = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        day_planned = [p for p in planned if p.date == day]
        m = match_day(day, [to_row(p) for p in day_planned], done.get(day, []), today)
        sessions = [
            SessionMatchOut(
                planned=planned_out(by_id[r.planned_id], r.status),
                status=r.status,
                activity=brief(r.activity) if r.activity else None,
                duration_delta_min=r.duration_delta_min,
                duration_ratio=r.duration_ratio,
                dplus_delta_m=r.dplus_delta_m,
            )
            for r in m.results
        ]
        days.append(
            DayPlanOut(
                date=day,
                weekday=WEEKDAYS_FR[day.weekday()],
                is_today=day == today,
                status=m.status,
                sessions=sessions,
                unplanned_activities=[brief(a) for a in m.unplanned],
                entry=entries.get(day),
            )
        )
    return days, planned, rows


def week_plan(
    session: Session, priority: Sequence[str], tz: ZoneInfo, week_of: date, today: date
) -> WeekPlanOut:
    start = monday(week_of)
    end = start + timedelta(days=6)
    days, planned, rows = _days(session, priority, tz, start, end, today)
    return WeekPlanOut(
        week_start=start,
        week_end=end,
        planned_min=sum(p.duree_min or 0 for p in planned if p.type != "repos"),
        done_min=sum(r.duration_s for r in rows) / 60,
        days=days,
    )


def range_plan(
    session: Session,
    priority: Sequence[str],
    tz: ZoneInfo,
    start: date,
    end: date,
    today: date,
) -> RangePlanOut:
    """Jours de `start` à `end` (inclus) : prévu, réalisé, statut, courses et plans présents."""
    days, planned, _ = _days(session, priority, tz, start, end, today)
    races = [
        RaceMarkerOut(id=g.id, nom=g.nom, date=g.date)
        for g in session.scalars(
            select(Goal).where(Goal.date >= start, Goal.date <= end).order_by(Goal.date)
        )
    ]
    plan_ids = sorted({p.plan_id for p in planned if p.plan_id is not None})
    plans = [
        PlanBriefOut(id=p.id, nom=p.nom)
        for p in session.scalars(select(Plan).where(Plan.id.in_(plan_ids)).order_by(Plan.id))
    ]
    return RangePlanOut(start=start, end=end, days=days, races=races, plans=plans)
