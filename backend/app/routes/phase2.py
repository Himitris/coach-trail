"""Endpoints de phase 2 : métriques (monotonie, fatigue, renforcement, objectif) et saisies."""

from datetime import UTC, date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics import phase2, service
from app.metrics.fatigue import FatigueReport
from app.metrics.fueling import DEFAULT_MIN_HOURS, FuelingSeries, fueling_series
from app.metrics.monotony import MonotonyReport
from app.metrics.race_goal import RaceGoalReport
from app.metrics.strength import StrengthReport
from app.models import Activity, FuelingEntry, Goal, StrengthSession
from app.routes.deps import get_db

router = APIRouter()

Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _ctx(request: Request) -> tuple[list[str], ZoneInfo, date]:
    settings = request.app.state.settings
    return settings.priority_list, ZoneInfo(settings.tz), request.app.state.today()


# --- métriques ------------------------------------------------------------------------------


@router.get("/metrics/monotony", response_model=MonotonyReport)
def monotony(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    weeks: Annotated[int, Query(ge=2, le=52)] = 12,
) -> MonotonyReport:
    priority, tz, today = _ctx(request)
    return phase2.monotony(db, service.load_rows(db, priority, tz), today, weeks)


@router.get("/metrics/fatigue", response_model=FatigueReport)
def fatigue(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    weeks: Annotated[int, Query(ge=1, le=52)] = 8,
) -> FatigueReport:
    priority, tz, today = _ctx(request)
    return phase2.fatigue(db, service.load_rows(db, priority, tz), today, weeks)


@router.get("/metrics/strength", response_model=StrengthReport)
def strength(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    weeks: Annotated[int, Query(ge=1, le=52)] = 8,
) -> StrengthReport:
    priority, tz, today = _ctx(request)
    target = service.get_profile(db).renfo_objectif_hebdo
    return phase2.strength(db, service.load_rows(db, priority, tz), target, today, weeks)


@router.get("/metrics/race-goal", response_model=RaceGoalReport)
def race_goal(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    goal_id: int | None = None,
) -> RaceGoalReport:
    """Objectif choisi, ou la prochaine course à venir (priorité la plus haute, puis la date)."""
    priority, tz, today = _ctx(request)
    if goal_id is not None:
        goal = db.get(Goal, goal_id)
    else:
        goal = db.scalars(
            select(Goal).where(Goal.date >= today).order_by(Goal.date, Goal.priorite)
        ).first()
    if goal is None:
        raise HTTPException(404, "Aucun objectif de course à venir.")
    return phase2.race_goal(db, service.load_rows(db, priority, tz), goal, today)


# --- nutrition en course --------------------------------------------------------------------


class FuelingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    glucides_g_par_h: Annotated[float, Field(ge=0, le=300)]
    score_digestif: Annotated[int, Field(ge=0, le=5)]
    note: Note | None = None


class FuelingCreate(FuelingIn):
    activity_id: int


class FuelingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    activity_id: int
    glucides_g_par_h: float
    score_digestif: int
    note: str | None
    updated_at: datetime


def _fueling(db: Session, entry_id: int) -> FuelingEntry:
    entry = db.get(FuelingEntry, entry_id)
    if entry is None:
        raise HTTPException(404, "Saisie de nutrition introuvable.")
    return entry


@router.get("/fueling", response_model=list[FuelingOut])
def list_fueling(db: Annotated[Session, Depends(get_db)]) -> list[FuelingEntry]:
    return list(db.scalars(select(FuelingEntry).order_by(FuelingEntry.activity_id.desc())))


@router.get("/fueling/series", response_model=FuelingSeries)
def fueling_progress(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    min_hours: Annotated[float, Query(gt=0, le=24)] = DEFAULT_MIN_HOURS,
) -> FuelingSeries:
    priority, tz, _ = _ctx(request)
    outings = phase2.fueling_outings(db, priority, service.load_rows(db, priority, tz))
    return fueling_series(outings, min_hours)


@router.post("/fueling", response_model=FuelingOut, status_code=201)
def create_fueling(body: FuelingCreate, db: Annotated[Session, Depends(get_db)]) -> FuelingEntry:
    act = db.get(Activity, body.activity_id)
    if act is None:
        raise HTTPException(422, "Cette sortie n'existe pas.")
    group = act.dedup_group_id or act.id
    twins = db.scalars(
        select(Activity.id).where((Activity.dedup_group_id == group) | (Activity.id == group))
    ).all()
    if db.scalars(select(FuelingEntry).where(FuelingEntry.activity_id.in_(twins))).first():
        raise HTTPException(409, "Cette sortie a déjà une saisie de nutrition (la modifier).")
    entry = FuelingEntry(**body.model_dump(), updated_at=_now())
    db.add(entry)
    db.commit()
    return entry


@router.put("/fueling/{entry_id}", response_model=FuelingOut)
def update_fueling(
    entry_id: int, body: FuelingIn, db: Annotated[Session, Depends(get_db)]
) -> FuelingEntry:
    entry = _fueling(db, entry_id)
    entry.glucides_g_par_h = body.glucides_g_par_h
    entry.score_digestif = body.score_digestif
    entry.note = body.note or None
    entry.updated_at = _now()
    db.commit()
    return entry


@router.delete("/fueling/{entry_id}", status_code=204)
def delete_fueling(entry_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    db.delete(_fueling(db, entry_id))
    db.commit()
    return Response(status_code=204)


# --- renforcement saisi à la main -----------------------------------------------------------


class StrengthIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    duree_min: Annotated[int, Field(ge=1, le=600)] | None = None
    note: Note | None = None


class StrengthOut(StrengthIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


@router.get("/strength/sessions", response_model=list[StrengthOut])
def list_strength(
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> list[StrengthSession]:
    query = select(StrengthSession).order_by(StrengthSession.date.desc(), StrengthSession.id)
    if from_:
        query = query.where(StrengthSession.date >= from_)
    if to:
        query = query.where(StrengthSession.date <= to)
    return list(db.scalars(query.limit(500)))


@router.post("/strength/sessions", response_model=StrengthOut, status_code=201)
def create_strength(body: StrengthIn, db: Annotated[Session, Depends(get_db)]) -> StrengthSession:
    row = StrengthSession(**body.model_dump())
    db.add(row)
    db.commit()
    return row


@router.delete("/strength/sessions/{session_id}", status_code=204)
def delete_strength(session_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    row = db.get(StrengthSession, session_id)
    if row is None:
        raise HTTPException(404, "Séance de renforcement introuvable.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
