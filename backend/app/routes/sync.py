from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SourceStatus
from app.routes.deps import get_db
from app.schemas import SourceHealthOut, SyncStartedOut, SyncStatusOut
from app.sync.scheduler import NIGHTLY_JOB_ID
from app.sync.service import CHECK_TRIGGER, SyncService

router = APIRouter()

LABELS = {"garmin": "Garmin", "intervals": "Intervals.icu", "strava": "Strava"}
STANDBY_MESSAGES = {
    "intervals": "En veille : sert de repli silencieux si Garmin est indisponible.",
}


def _service(request: Request) -> SyncService:
    service: SyncService = request.app.state.sync_service
    return service


@router.post("/sync/run", response_model=SyncStartedOut, status_code=202)
def run_sync(request: Request) -> SyncStartedOut:
    if not _service(request).start_async("manual"):
        raise HTTPException(409, "Une synchronisation est déjà en cours")
    return SyncStartedOut(started=True)


@router.post("/sync/check", response_model=SyncStartedOut, status_code=202)
def check_sync(request: Request) -> SyncStartedOut:
    """Vérification rapide : ne récupère que les activités plus récentes que la dernière connue."""
    if not _service(request).start_async(CHECK_TRIGGER):
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
        message = st.message if st else None
        if st is None or (st.state is None and st.last_success_at is None):
            state, badge = "jamais_synchronise", None
            message = message or STANDBY_MESSAGES.get(name, "Aucune synchronisation effectuée")
        else:
            state = st.state or ("down" if st.unavailable_since else "ok")
            badge = (
                f"{label} indisponible depuis le {st.unavailable_since:%d/%m/%Y}"
                if st.unavailable_since
                else None
            )
        out.append(
            SourceHealthOut(
                source=name,
                label=label,
                state=state,
                last_success_at=st.last_success_at if st else None,
                last_error_at=st.last_error_at if st else None,
                last_error_message=st.last_error_message if st else None,
                unavailable_since=st.unavailable_since if st else None,
                message=message,
                badge=badge,
            )
        )
    return out
