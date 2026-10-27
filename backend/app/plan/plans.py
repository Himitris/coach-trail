"""Plans d'entraînement : bornes, rattachement à une course, suppression, lecture."""

import unicodedata
from collections.abc import Sequence
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Goal, Plan, PlannedSession
from app.plan.schemas import PlanOut


def refresh_bounds(db: Session, plan_id: int | None) -> None:
    """Recale les dates d'un plan sur ses séances (inchangées s'il n'en a plus)."""
    if plan_id is None:
        return
    plan = db.get(Plan, plan_id)
    if plan is None:
        return
    first, last = db.execute(
        select(func.min(PlannedSession.date), func.max(PlannedSession.date)).where(
            PlannedSession.plan_id == plan_id
        )
    ).one()
    if first is not None:
        plan.date_debut, plan.date_fin = first, last


def _norm(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(folded.casefold().split())


def resolve_course(db: Session, asked: str) -> Goal | None:
    """Course désignée par un nom (accents et casse ignorés, nom partiel accepté) ou une date."""
    goals = list(db.scalars(select(Goal)))
    try:
        day = date.fromisoformat(asked.strip())
    except ValueError:
        pass
    else:
        by_date = [g for g in goals if g.date == day]
        return by_date[0] if len(by_date) == 1 else None
    wanted = _norm(asked)
    if not wanted:
        return None
    exact = [g for g in goals if _norm(g.nom) == wanted]
    if len(exact) == 1:
        return exact[0]
    partial = [g for g in goals if wanted in _norm(g.nom) or _norm(g.nom) in wanted]
    return partial[0] if len(partial) == 1 else None


def plan_out(db: Session, plan: Plan) -> PlanOut:
    count = db.scalar(
        select(func.count()).select_from(PlannedSession).where(PlannedSession.plan_id == plan.id)
    )
    goal = db.get(Goal, plan.goal_id) if plan.goal_id is not None else None
    return PlanOut(
        id=plan.id,
        nom=plan.nom,
        date_debut=plan.date_debut,
        date_fin=plan.date_fin,
        goal_id=plan.goal_id,
        goal_nom=goal.nom if goal else None,
        nb_seances=count or 0,
    )


def delete_plan(db: Session, plan: Plan, kept_ids: Sequence[int]) -> tuple[int, int]:
    """Supprime le plan et ses séances, sauf `kept_ids` (déjà réalisées) qui sont détachées.

    Renvoie (séances supprimées, séances conservées).
    """
    scope = (PlannedSession.plan_id == plan.id, PlannedSession.id.not_in(list(kept_ids)))
    removed = db.scalar(select(func.count()).select_from(PlannedSession).where(*scope)) or 0
    db.execute(delete(PlannedSession).where(*scope))
    kept = len(kept_ids)
    # les séances conservées sont détachées par la contrainte ON DELETE SET NULL
    db.delete(plan)
    db.commit()
    return removed, kept
