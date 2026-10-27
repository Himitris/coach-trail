from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.models import monday
from app.models import Activity, ActivityWorkoutLabel, PlannedSession
from app.plan import importer, service
from app.plan.plans import refresh_bounds
from app.plan.schemas import PlannedIn, PlannedOut, RangePlanOut, WeekPlanOut
from app.routes.deps import get_db

router = APIRouter(prefix="/plan")

MAX_SPAN_DAYS = 400
MAX_RANGE_DAYS = 62


def _ctx(request: Request) -> tuple[list[str], ZoneInfo, date]:
    settings = request.app.state.settings
    today: Callable[[], date] = request.app.state.today
    return settings.priority_list, ZoneInfo(settings.tz), today()


def _get(db: Session, session_id: int) -> PlannedSession:
    planned = db.get(PlannedSession, session_id)
    if planned is None:
        raise HTTPException(404, "Séance prévue introuvable.")
    return planned


def _out(request: Request, db: Session, planned: PlannedSession) -> PlannedOut:
    priority, tz, today = _ctx(request)
    # statut calculé avec toutes les séances prévues du même jour (rapprochement)
    same_day = list(
        db.scalars(
            select(PlannedSession)
            .where(PlannedSession.date == planned.date)
            .order_by(PlannedSession.id)
        )
    )
    outs = service.with_status(db, priority, tz, today, same_day)
    return next(o for o in outs if o.id == planned.id)


@router.post("/sessions", response_model=PlannedOut, status_code=201)
def create_session(
    body: PlannedIn, request: Request, db: Annotated[Session, Depends(get_db)]
) -> PlannedOut:
    planned = PlannedSession()
    service.apply_fields(planned, body)
    db.add(planned)
    db.commit()
    return _out(request, db, planned)


@router.get("/sessions", response_model=list[PlannedOut])
def list_sessions(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> list[PlannedOut]:
    priority, tz, today = _ctx(request)
    start = from_ or monday(today)
    end = to or start + timedelta(days=27)
    if start > end:
        raise HTTPException(422, "« from » doit précéder « to ».")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(422, f"Période limitée à {MAX_SPAN_DAYS} jours.")
    planned = list(
        db.scalars(
            select(PlannedSession)
            .where(PlannedSession.date >= start, PlannedSession.date <= end)
            .order_by(PlannedSession.date, PlannedSession.id)
        )
    )
    return service.with_status(db, priority, tz, today, planned)


@router.get("/week", response_model=WeekPlanOut)
def week(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> WeekPlanOut:
    priority, tz, today = _ctx(request)
    return service.week_plan(db, priority, tz, date_ or today, today)


@router.get("/range", response_model=RangePlanOut)
def plan_range(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date, Query(alias="from")],
    to: date,
) -> RangePlanOut:
    """Calendrier : une entrée par jour de `from` à `to` (62 jours au plus)."""
    if from_ > to:
        raise HTTPException(422, "« from » doit précéder « to ».")
    if (to - from_).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(422, f"Période limitée à {MAX_RANGE_DAYS} jours.")
    priority, tz, today = _ctx(request)
    return service.range_plan(db, priority, tz, from_, to, today)


@router.get("/sessions/{session_id}", response_model=PlannedOut)
def read_session(
    session_id: int, request: Request, db: Annotated[Session, Depends(get_db)]
) -> PlannedOut:
    return _out(request, db, _get(db, session_id))


@router.put("/sessions/{session_id}", response_model=PlannedOut)
def update_session(
    session_id: int,
    body: PlannedIn,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> PlannedOut:
    planned = _get(db, session_id)
    service.apply_fields(planned, body)
    refresh_bounds(db, planned.plan_id)
    db.commit()
    return _out(request, db, planned)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    planned = _get(db, session_id)
    plan_id = planned.plan_id
    db.delete(planned)
    db.flush()
    refresh_bounds(db, plan_id)
    db.commit()
    return Response(status_code=204)


@router.post("/import", response_model=importer.ImportReport)
async def import_plan(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    dry_run: bool = True,
    confirm_past_done: bool = False,
    confirm_overlap: bool = False,
) -> importer.ImportReport | JSONResponse:
    """Importe un plan JSON. `dry_run=true` (défaut) : aperçu sans rien écrire.

    Les jours passés dont la séance est déjà réalisée ne sont modifiés qu'avec `confirm_past_done` ;
    les jours qui appartiennent à un autre plan, qu'avec `confirm_overlap`.
    """
    priority, tz, today = _ctx(request)
    try:
        data = await request.json()
    except ValueError:
        return _import_errors(
            [
                importer.ImportIssue(
                    session=None, field=None, message="Le fichier n'est pas un JSON valide."
                )
            ]
        )
    parsed, issues, meta = importer.parse_document(data, today)
    if issues:
        return _import_errors(issues)
    return importer.plan_import(
        db,
        parsed,
        today=today,
        priority=priority,
        tz=tz,
        dry_run=dry_run,
        confirm_past_done=confirm_past_done,
        confirm_overlap=confirm_overlap,
        meta=meta,
    )


def _import_errors(issues: list[importer.ImportIssue]) -> JSONResponse:
    n = len(issues)
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "message": (
                    f"Le plan contient {n} erreur{'s' if n > 1 else ''} : rien n'a été enregistré."
                ),
                "errors": [i.model_dump() for i in issues],
            }
        },
    )


class WorkoutTypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["footing", "cotes", "seuil", "longue", "fractionne", "course"] | None


@router.put("/activities/{activity_id}/workout-type", status_code=204)
def set_workout_type(
    activity_id: int, body: WorkoutTypeIn, db: Annotated[Session, Depends(get_db)]
) -> Response:
    """Corrige à la main le type d'une sortie (`null` : revient au type calculé)."""
    if db.get(Activity, activity_id) is None:
        raise HTTPException(404, "Activité introuvable.")
    label = db.get(ActivityWorkoutLabel, activity_id)
    if body.type is None:
        if label is not None:
            db.delete(label)
    elif label is None:
        db.add(
            ActivityWorkoutLabel(
                activity_id=activity_id,
                type=body.type,
                updated_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    else:
        label.type = body.type
        label.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    return Response(status_code=204)
