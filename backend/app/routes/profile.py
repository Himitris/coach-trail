from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.models import AthleteProfile
from app.routes.deps import get_db
from app.schemas import ProfileOut, ProfileUpdate

router = APIRouter(prefix="/profile")


def _get(db: Session) -> AthleteProfile:
    profile = db.get(AthleteProfile, 1)
    if profile is None:
        raise HTTPException(500, "Profil absent : migrations non appliquées ?")
    return profile


@router.get("", response_model=ProfileOut)
def read_profile(db: Annotated[Session, Depends(get_db)]) -> AthleteProfile:
    return _get(db)


@router.put("", response_model=ProfileOut)
def update_profile(body: ProfileUpdate, db: Annotated[Session, Depends(get_db)]) -> AthleteProfile:
    profile = _get(db)
    for field in body.model_fields_set:
        setattr(profile, field, getattr(body, field))
    profile.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    return profile
