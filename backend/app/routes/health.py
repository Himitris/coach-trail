from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.routes.deps import get_db
from app.schemas import HealthOut

router = APIRouter()


@router.get("/health", response_model=HealthOut)
def health(db: Annotated[Session, Depends(get_db)]) -> HealthOut:
    try:
        db.execute(text("SELECT 1"))
        state = "ok"
    except Exception:
        state = "error"
    return HealthOut(status="ok" if state == "ok" else "degraded", version=__version__, db=state)
