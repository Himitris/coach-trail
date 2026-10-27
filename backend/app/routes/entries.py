from collections.abc import Callable
from datetime import date, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.plan.entries import EntryError, read_entries, upsert_entry
from app.plan.schemas import EntryIn, EntryOut
from app.routes.deps import get_db

router = APIRouter(prefix="/entries")

MAX_SPAN_DAYS = 400


@router.put("/{day}", response_model=EntryOut)
def put_entry(
    day: date, body: EntryIn, request: Request, db: Annotated[Session, Depends(get_db)]
) -> EntryOut:
    """Saisie du soir : tout est optionnel, seuls les champs fournis sont modifiés."""
    today: Callable[[], date] = request.app.state.today
    if day > today():
        raise HTTPException(422, "Impossible de saisir une date future.")
    settings = request.app.state.settings
    try:
        return upsert_entry(db, day, body, settings.priority_list, ZoneInfo(settings.tz))
    except EntryError as err:
        db.rollback()
        raise HTTPException(err.status_code, err.message) from None


@router.get("/{day}", response_model=EntryOut)
def get_entry(day: date, db: Annotated[Session, Depends(get_db)]) -> EntryOut:
    entries = read_entries(db, day, day)
    if not entries:
        raise HTTPException(404, "Aucune saisie ce jour-là.")
    return entries[0]


@router.get("", response_model=list[EntryOut])
def list_entries(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> list[EntryOut]:
    today: Callable[[], date] = request.app.state.today
    end = to or today()
    start = from_ or end - timedelta(days=30)
    if start > end:
        raise HTTPException(422, "« from » doit précéder « to ».")
    if (end - start).days > MAX_SPAN_DAYS:
        raise HTTPException(422, f"Période limitée à {MAX_SPAN_DAYS} jours.")
    return read_entries(db, start, end)
