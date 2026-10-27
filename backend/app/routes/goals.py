from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

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
