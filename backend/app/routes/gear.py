"""Matériel : liste et kilométrage, paires, affectation manuelle des sorties."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import gear
from app.models import Activity, GearAssignment, GearItem
from app.routes.deps import get_db

router = APIRouter(prefix="/gear")

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class GearIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nom: Name
    seuil_km: Annotated[int, Field(ge=50, le=5000)] = gear.DEFAULT_THRESHOLD_KM
    km_initial: Annotated[float, Field(ge=0, le=20000)] = 0.0
    retire: bool = False


class GearUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nom: Name | None = None
    seuil_km: Annotated[int, Field(ge=50, le=5000)] | None = None
    km_initial: Annotated[float, Field(ge=0, le=20000)] | None = None
    retire: bool | None = None


class AssignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    activity_id: int
    gear_id: int | None  # None : retire l'affectation manuelle


def _get(db: Session, gear_id: int) -> GearItem:
    item = db.get(GearItem, gear_id)
    if item is None:
        raise HTTPException(404, "Paire introuvable.")
    return item


def _tz(request: Request) -> str:
    tz: str = request.app.state.settings.tz
    return tz


@router.get("", response_model=gear.GearReport)
def gear_report(request: Request, db: Annotated[Session, Depends(get_db)]) -> gear.GearReport:
    priority = request.app.state.settings.priority_list
    return gear.build_report(db, priority, _tz(request))


def _save(db: Session, item: GearItem) -> GearItem:
    try:
        db.add(item)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Une paire porte déjà ce nom.") from None
    return item


@router.post("", status_code=201)
def create_gear(body: GearIn, db: Annotated[Session, Depends(get_db)]) -> dict[str, int]:
    item = _save(db, GearItem(**body.model_dump()))
    return {"id": item.id}


@router.put("/{gear_id}", status_code=204)
def update_gear(
    gear_id: int, body: GearUpdate, db: Annotated[Session, Depends(get_db)]
) -> Response:
    item = _get(db, gear_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            raise HTTPException(422, f"« {field} » ne peut pas être vide.")
        setattr(item, field, value)
    _save(db, item)
    return Response(status_code=204)


@router.delete("/{gear_id}", status_code=204)
def delete_gear(gear_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    db.delete(_get(db, gear_id))
    db.commit()
    return Response(status_code=204)


@router.put("/assign/activity", status_code=204)
def assign_gear(
    body: AssignIn, request: Request, db: Annotated[Session, Depends(get_db)]
) -> Response:
    """Affecte une sortie à une paire (toute la séance réelle, même vue par plusieurs sources)."""
    act = db.get(Activity, body.activity_id)
    if act is None:
        raise HTTPException(422, "Cette sortie n'existe pas.")
    group = act.dedup_group_id or act.id
    twins = list(
        db.scalars(
            select(Activity.id).where((Activity.dedup_group_id == group) | (Activity.id == group))
        )
    )
    db.execute(delete(GearAssignment).where(GearAssignment.activity_id.in_(twins)))
    if body.gear_id is not None:
        _get(db, body.gear_id)
        db.add(GearAssignment(activity_id=act.id, gear_id=body.gear_id))
    db.commit()
    return Response(status_code=204)
