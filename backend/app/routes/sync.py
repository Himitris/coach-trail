from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SourceStatus
from app.routes.deps import get_db
from app.schemas import SourceHealthOut, SyncStartedOut, SyncStatusOut
from app.sync.scheduler import NIGHTLY_JOB_ID
from app.sync.service import SyncService

router = APIRouter()

LABELS = {"garmin": "Garmin", "intervals": "Intervals.icu", "strava": "Strava"}


def _service(request: Request) -> SyncService:
    service: SyncService = request.app.state.sync_service
    return service


@router.post("/sync/run", response_model=SyncStartedOut, status_code=202)
def run_sync(request: Request) -> SyncStartedOut:
    if not _service(request).start_async("manual"):
        raise HTTPException(409, "Une synchronisation est déjà en cours")
    return SyncStartedOut(started=True)


@router.get("/sync/status", response_model=SyncStatusOut)
def sync_status(request: Request) -> SyncStatusOut:
    service = _service(request)
    scheduler = request.app.state.scheduler
    job = scheduler.get_job(NIGHTLY_JOB_ID) if scheduler is not None else None
    next_run = getattr(job, "next_run_time", None)
    return SyncStatusOut.model_validate(
        {
            "running": service.running,
            "nightly_time": request.app.state.settings.sync_time,
            "next_run_at": next_run.replace(tzinfo=None) if next_run else None,
            "current": service.current,
            "last_run": service.last_report,
        }
    )


@router.get("/sources/health", response_model=list[SourceHealthOut])
def sources_health(
    request: Request, db: Annotated[Session, Depends(get_db)]
) -> list[SourceHealthOut]:
    """Lit uniquement la base locale : aucune source n'est appelée."""
    statuses = {s.source: s for s in db.scalars(select(SourceStatus))}
    names = list(_service(request).connectors)
    names += [n for n in statuses if n not in names]
    out: list[SourceHealthOut] = []
    for name in names:
        st = statuses.get(name)
        label = LABELS.get(name, name)
        if st is None or (st.last_success_at is None and st.unavailable_since is None):
            state, badge = "jamais_synchronise", None
        elif st.unavailable_since is not None:
            state = "indisponible"
            badge = f"{label} indisponible depuis le {st.unavailable_since:%d/%m/%Y}"
        else:
            state, badge = "ok", None
        out.append(
            SourceHealthOut(
                source=name,
                label=label,
                state=state,
                last_success_at=st.last_success_at if st else None,
                last_error_at=st.last_error_at if st else None,
                last_error_message=st.last_error_message if st else None,
                unavailable_since=st.unavailable_since if st else None,
                badge=badge,
            )
        )
    return out
