"""Import manuel d'une séance FIT ou GPX (secours et rattrapage) : lecture, normalisation, dédup."""

from datetime import UTC
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import activity_import
from app.imports.normalize import IMPORT_NORMALIZER, SOURCE
from app.models import Activity
from app.routes.deps import get_db
from app.sync.dedup import assign_dedup_groups
from app.sync.service import SourceResult, SyncService, normalize_raw
from app.sync.types import RAW_ACTIVITY, RAW_STREAM, RawRecord

router = APIRouter(prefix="/import")

STREAM_NAMES = {
    "t": "time", "fc": "heartrate", "altitude": "altitude", "speed": "velocity_smooth",
    "distance": "distance", "cadence": "cadence",
}  # fmt: skip


class ImportedActivity(BaseModel):
    activity_id: int
    created: bool  # False : ce fichier avait déjà été importé
    sport: str
    start_utc: str
    duration_min: float
    distance_km: float | None
    dplus_m: float | None
    hr_avg: int | None
    has_stream: bool
    same_session_as: list[str]  # sources qui connaissaient déjà cette séance (déduplication)
    warnings: list[str]


@router.post("/activity", response_model=ImportedActivity, status_code=201)
async def import_activity(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    filename: Annotated[str | None, Query(max_length=200)] = None,
    sport: Annotated[str | None, Query(pattern=r"^[a-z_]{3,40}$")] = None,
) -> ImportedActivity:
    """Corps = contenu brut du fichier .fit ou .gpx. Idempotent : même fichier, même séance."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > activity_import.MAX_BYTES:
        raise HTTPException(413, "Fichier trop volumineux (20 Mo maximum).")
    data = await request.body()
    try:
        parsed = activity_import.parse_activity(data, filename, sport)
    except activity_import.ImportFailure as exc:
        raise HTTPException(422, str(exc)) from exc
    key = activity_import.file_hash(data)

    activity_payload = {
        "id": key,
        "format": parsed.format,
        "name": parsed.name,
        "filename": (filename or "")[:200] or None,
        "sport": parsed.sport,
        "start": parsed.start_utc.replace(tzinfo=UTC).isoformat(),
        "duration_s": parsed.duration_s,
        "distance_m": parsed.distance_m,
        "gain_m": parsed.gain_m,
        "loss_m": parsed.loss_m,
        "hr_avg": parsed.hr_avg,
        "hr_max": parsed.hr_max,
        "calories": parsed.calories,
    }
    result = SourceResult(source=SOURCE)
    already = db.scalars(
        select(Activity).where(Activity.source == SOURCE, Activity.external_id == key)
    ).first()
    raws = []
    raw = SyncService._upsert_raw(
        db, SOURCE, RAW_ACTIVITY, RawRecord(key, activity_payload), result
    )
    if raw is not None:
        raws.append(raw)
    if parsed.samples:
        streams = {STREAM_NAMES[k]: v for k, v in parsed.samples.items() if k in STREAM_NAMES}
        raw = SyncService._upsert_raw(
            db, SOURCE, RAW_STREAM, RawRecord(key, {"streams": streams}), result
        )
        if raw is not None:
            raws.append(raw)
    db.flush()
    for r in raws:
        normalize_raw(db, r, {SOURCE: IMPORT_NORMALIZER})
    assign_dedup_groups(db)
    db.commit()

    act = db.scalars(
        select(Activity).where(Activity.source == SOURCE, Activity.external_id == key)
    ).one()
    twins = sorted(
        {
            a.source
            for a in db.scalars(
                select(Activity).where(
                    Activity.dedup_group_id == act.dedup_group_id, Activity.id != act.id
                )
            )
        }
        if act.dedup_group_id is not None
        else set()
    )
    return ImportedActivity(
        activity_id=act.id,
        created=already is None,
        sport=act.sport,
        start_utc=act.start_utc.isoformat(),
        duration_min=act.duration_s / 60,
        distance_km=act.distance_m / 1000 if act.distance_m else None,
        dplus_m=act.elevation_gain_m,
        hr_avg=act.hr_avg,
        has_stream=bool(parsed.samples),
        same_session_as=twins,
        warnings=parsed.warnings,
    )
