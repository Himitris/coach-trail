from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy.orm import Session

from app.models import Goal, RacePlan
from app.race_plan import RacePlanDoc, warnings_for
from app.routes.deps import get_db

router = APIRouter(prefix="/goals")


class RacePlanOut(BaseModel):
    goal_id: int
    data: dict[str, Any]
    updated_at: datetime
    warnings: list[str] = []
    checks: list[str] = []


def _goal(db: Session, goal_id: int) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(404, "Objectif introuvable")
    return goal


@router.get("/{goal_id}/race-plan", response_model=RacePlanOut)
def read_race_plan(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> RacePlanOut:
    _goal(db, goal_id)
    row = db.get(RacePlan, goal_id)
    if row is None:
        raise HTTPException(404, "Pas de plan de course pour cet objectif")
    doc = RacePlanDoc.model_validate(row.data)
    return RacePlanOut(
        goal_id=goal_id,
        data=row.data,
        updated_at=row.updated_at,
        warnings=warnings_for(doc),
        checks=list(row.checks),
    )


@router.put("/{goal_id}/race-plan", response_model=RacePlanOut)
def put_race_plan(
    goal_id: int,
    body: RacePlanDoc,
    db: Annotated[Session, Depends(get_db)],
    dry_run: Annotated[bool, Query()] = False,
) -> RacePlanOut:
    """Remplace le plan de course de l'objectif ; `dry_run` valide sans rien écrire."""
    _goal(db, goal_id)
    data = body.model_dump(mode="json", exclude_none=True)
    now = datetime.now(UTC).replace(tzinfo=None)
    if not dry_run:
        row = db.get(RacePlan, goal_id)
        if row is None:
            db.add(RacePlan(goal_id=goal_id, data=data, updated_at=now, checks=[]))
        else:
            row.data = data
            row.updated_at = now
            row.checks = []  # un nouveau plan n'a pas les mêmes étapes : on repart de zéro
        db.commit()
    return RacePlanOut(goal_id=goal_id, data=data, updated_at=now, warnings=warnings_for(body))


@router.delete("/{goal_id}/race-plan", status_code=204)
def delete_race_plan(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    _goal(db, goal_id)
    row = db.get(RacePlan, goal_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


class CheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    done: bool


MAX_CHECKS = 300


@router.post("/{goal_id}/race-plan/checks", response_model=list[str])
def set_check(
    goal_id: int, body: CheckIn, db: Annotated[Session, Depends(get_db)]
) -> list[str]:
    """Coche ou décoche une étape ; chaque appareil envoie sa seule modification (pas la liste)."""
    _goal(db, goal_id)
    row = db.get(RacePlan, goal_id)
    if row is None:
        raise HTTPException(404, "Pas de plan de course pour cet objectif")
    checks = [k for k in row.checks if k != body.key]
    if body.done:
        checks.append(body.key)
    if len(checks) > MAX_CHECKS:
        raise HTTPException(422, "Trop d'étapes cochées")
    row.checks = checks
    db.commit()
    return checks


@router.delete("/{goal_id}/race-plan/checks", response_model=list[str])
def clear_checks(goal_id: int, db: Annotated[Session, Depends(get_db)]) -> list[str]:
    _goal(db, goal_id)
    row = db.get(RacePlan, goal_id)
    if row is not None:
        row.checks = []
        db.commit()
    return []
