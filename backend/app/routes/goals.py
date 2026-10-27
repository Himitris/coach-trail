import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.gpx import MAX_BYTES, GpxError, parse_gpx, summarize
from app.models import Goal
from app.routes.deps import get_db
from app.schemas import GoalCreate, GoalOut, GoalUpdate

router = APIRouter(prefix="/goals")


def _get(db: Session, goal_id: int) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(404, "Objectif introuvable")
    return goal


@router.get("", response_model=list[GoalOut])
def list_goals(db: Annotated[Session, Depends(get_db)]) -> list[Goal]:
    return list(db.scalars(select(Goal).order_by(Goal.date)))


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(body: GoalCreate, db: Annotated[Session, Depends(get_db)]) -> Goal:
    goal = Goal(**body.model_dump())
    db.add(goal)
    db.commit()
    return goal


@router.get("/{goal_id}", response_model=GoalOut)
def read_goal(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> Goal:
    return _get(db, goal_id)


@router.put("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, db: Annotated[Session, Depends(get_db)]) -> Goal:
    goal = _get(db, goal_id)
    for field, value in body.model_dump().items():
        setattr(goal, field, value)
    db.commit()
    return goal


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    db.delete(_get(db, goal_id))
    db.commit()
    return Response(status_code=204)


# --- profil altimétrique de la course -------------------------------------------------------

MAX_PROFILE_POINTS = 2000


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[tuple[float, float]] = Field(min_length=2, max_length=MAX_PROFILE_POINTS)

    @field_validator("points")
    @classmethod
    def _check(cls, points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        last = -1.0
        for km, alt in points:
            if not (math.isfinite(km) and math.isfinite(alt)):
                raise ValueError("valeurs non finies")
            if km < 0 or km <= last:
                raise ValueError("les kilomètres doivent être positifs et strictement croissants")
            if not -500 <= alt <= 9000:
                raise ValueError("altitude hors de [-500 ; 9000] m")
            last = km
        return points


class GpxIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gpx: Annotated[str, StringConstraints(min_length=1, max_length=MAX_BYTES)]
    apply_totals: bool = False  # renseigne distance et D+ de l'objectif s'ils sont vides


class GpxSummaryOut(BaseModel):
    distance_km: float
    dplus_m: float | None
    dminus_m: float | None
    points: int
    goal: GoalOut


@router.put("/{goal_id}/profile", response_model=GoalOut)
def set_profile(goal_id: int, body: ProfileIn, db: Annotated[Session, Depends(get_db)]) -> Goal:
    goal = _get(db, goal_id)
    goal.profil_points = [[km, alt] for km, alt in body.points]
    db.commit()
    return goal


@router.post("/{goal_id}/profile/gpx", response_model=GpxSummaryOut)
def import_gpx(goal_id: int, body: GpxIn, db: Annotated[Session, Depends(get_db)]) -> GpxSummaryOut:
    goal = _get(db, goal_id)
    try:
        summary = summarize(parse_gpx(body.gpx))
    except GpxError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not summary.profile:
        raise HTTPException(422, "La trace GPX ne contient pas d'altitude : profil impossible.")
    goal.profil_points = [[km, alt] for km, alt in summary.profile]
    if body.apply_totals:
        if goal.distance_km is None:
            goal.distance_km = round(summary.distance_km, 1)
        if goal.dplus_m is None and summary.dplus_m is not None:
            goal.dplus_m = round(summary.dplus_m)
    db.commit()
    return GpxSummaryOut(
        distance_km=summary.distance_km,
        dplus_m=summary.dplus_m,
        dminus_m=summary.dminus_m,
        points=len(summary.profile),
        goal=GoalOut.model_validate(goal),
    )


@router.delete("/{goal_id}/profile", response_model=GoalOut)
def clear_profile(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> Goal:
    goal = _get(db, goal_id)
    goal.profil_points = None
    db.commit()
    return goal
