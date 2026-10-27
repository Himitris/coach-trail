from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Goal, Plan, PlannedSession
from app.plan import plans, service
from app.plan.matching import FAIT, PARTIEL
from app.plan.schemas import PlanCourseIn, PlanDeleteOut, PlanIn, PlanOut
from app.routes.deps import get_db
from app.routes.plan import _ctx

router = APIRouter(prefix="/plans")


def _get(db: Session, plan_id: int) -> Plan:
    plan = db.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan introuvable.")
    return plan


def _check_goal(db: Session, goal_id: int | None) -> None:
    if goal_id is not None and db.get(Goal, goal_id) is None:
        raise HTTPException(404, "Course introuvable.")


def _save(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Un plan porte déjà ce nom.") from exc


@router.get("", response_model=list[PlanOut])
def list_plans(db: Annotated[Session, Depends(get_db)]) -> list[PlanOut]:
    rows = db.scalars(select(Plan).order_by(Plan.date_debut, Plan.id))
    return [plans.plan_out(db, p) for p in rows]


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(body: PlanIn, db: Annotated[Session, Depends(get_db)]) -> PlanOut:
    _check_goal(db, body.goal_id)
    plan = Plan(**body.model_dump())
    db.add(plan)
    _save(db)
    return plans.plan_out(db, plan)


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: int, body: PlanIn, db: Annotated[Session, Depends(get_db)]) -> PlanOut:
    plan = _get(db, plan_id)
    _check_goal(db, body.goal_id)
    for field, value in body.model_dump().items():
        setattr(plan, field, value)
    _save(db)
    return plans.plan_out(db, plan)


@router.put("/{plan_id}/course", response_model=PlanOut)
def set_course(
    plan_id: int, body: PlanCourseIn, db: Annotated[Session, Depends(get_db)]
) -> PlanOut:
    """Attribue le plan à une course (`goal_id`) ou le détache (`null`)."""
    plan = _get(db, plan_id)
    _check_goal(db, body.goal_id)
    plan.goal_id = body.goal_id
    db.commit()
    return plans.plan_out(db, plan)


@router.delete("/{plan_id}", response_model=PlanDeleteOut)
def delete_plan(
    plan_id: int, request: Request, db: Annotated[Session, Depends(get_db)]
) -> PlanDeleteOut:
    """Supprime le plan et ses séances ; celles déjà réalisées (fait / partiel) sont conservées,
    détachées de tout plan."""
    plan = _get(db, plan_id)
    priority, tz, today = _ctx(request)
    sessions = list(db.scalars(select(PlannedSession).where(PlannedSession.plan_id == plan.id)))
    results = service.status_by_id(service.match_planned(db, priority, tz, today, sessions))
    kept = [p.id for p in sessions if p.id in results and results[p.id].status in (FAIT, PARTIEL)]
    removed, kept_n = plans.delete_plan(db, plan, kept)
    return PlanDeleteOut(removed=removed, kept=kept_n)
