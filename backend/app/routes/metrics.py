from collections.abc import Callable
from datetime import date, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.metrics import service
from app.metrics.fitness import FitnessReport
from app.metrics.intensity import IntensityReport
from app.metrics.models import Evidence
from app.metrics.recovery import BaselineComparison, GarminAcwr, ProprietaryMetric
from app.metrics.srpe import EntryReader, SRPESummary, srpe_summary
from app.metrics.volume import WeekVolumeReport, week_report
from app.routes.deps import get_db

router = APIRouter(prefix="/metrics")

MAX_FITNESS_SPAN_DAYS = 800


def _today(request: Request) -> date:
    today: Callable[[], date] = request.app.state.today
    return today()


def _tz(request: Request) -> ZoneInfo:
    return ZoneInfo(request.app.state.settings.tz)


def _priority(request: Request) -> list[str]:
    priority: list[str] = request.app.state.settings.priority_list
    return priority


class WeekMetrics(WeekVolumeReport):
    srpe: SRPESummary | None = None


@router.get("/week", response_model=WeekMetrics)
def week(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> WeekMetrics:
    today = _today(request)
    rows = service.load_rows(db, _priority(request), _tz(request))
    report = week_report(rows, date_ or today, today)
    reader: EntryReader = request.app.state.entry_reader
    entries = reader.read_srpe(report.week_start, report.week_end)
    return WeekMetrics(**report.model_dump(), srpe=srpe_summary(entries))


@router.get("/intensity", response_model=IntensityReport)
def intensity(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    weeks: Annotated[int, Query(ge=1, le=52)] = 8,
) -> IntensityReport:
    rows = service.load_rows(db, _priority(request), _tz(request))
    return service.intensity(db, rows, _today(request), weeks)


class FitnessWithReference(FitnessReport):
    reference: service.LoadReference | None = None


@router.get("/fitness", response_model=FitnessWithReference)
def fitness(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
) -> FitnessWithReference:
    today = _today(request)
    end = to or today
    start = from_ or end - timedelta(days=90)
    if start > end:
        raise HTTPException(422, "« from » doit précéder « to ».")
    if (end - start).days > MAX_FITNESS_SPAN_DAYS:
        raise HTTPException(422, f"Période limitée à {MAX_FITNESS_SPAN_DAYS} jours.")
    rows = service.load_rows(db, _priority(request), _tz(request))
    report = service.fitness(db, rows, today, start, end)
    return FitnessWithReference(**report.model_dump(), reference=service.load_reference(db, report))


class RecoveryMetrics(BaseModel):
    date: date
    fallback: service.FallbackNotice | None
    baseline_days: int
    hrv: BaselineComparison
    resting_hr: BaselineComparison
    sleep_duration_h: BaselineComparison
    sleep_efficiency_pct: BaselineComparison
    training_readiness: ProprietaryMetric
    body_battery_max: ProprietaryMetric
    body_battery_min: ProprietaryMetric
    garmin_hrv_reference: dict[str, float | str] | None
    acwr: GarminAcwr | None


@router.get("/recovery", response_model=RecoveryMetrics)
def recovery(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=30, le=60)] = 60,
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> RecoveryMetrics:
    """`days` : longueur de la base de comparaison (30 à 60 jours) ; moyenne récente sur 7 jours."""
    end = date_ or _today(request)
    parts = service.recovery_parts(db, _priority(request), end, days)
    ref = service.latest_garmin_reference(db, end)
    return RecoveryMetrics.model_validate(
        {
            "date": end,
            "baseline_days": days,
            "fallback": service.fallback_notice(db, end),
            **parts,
            "garmin_hrv_reference": (
                {
                    "date": ref[0].isoformat(),
                    "min": ref[1],
                    "max": ref[2],
                    "label": "plage de référence Garmin, avis de la montre non validé",
                }
                if ref
                else None
            ),
            "acwr": service.latest_acwr(db, end),
        }
    )


class WellnessPoint(BaseModel):
    date: date
    hrv_nuit: float | None
    hrv_base_min: float | None
    hrv_base_max: float | None
    fc_repos: float | None
    sommeil_duree_h: float | None
    sommeil_efficacite: float | None
    training_readiness: float | None
    body_battery_max: float | None
    body_battery_min: float | None


class WellnessSeries(BaseModel):
    start: date
    end: date
    points: list[WellnessPoint]
    evidence: Evidence


@router.get("/wellness", response_model=WellnessSeries)
def wellness(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=7, le=365)] = 60,
    date_: Annotated[date | None, Query(alias="date")] = None,
) -> WellnessSeries:
    """Valeurs quotidiennes (HRV, FC repos, sommeil, avis montre) : uniquement les jours reçus."""
    end = date_ or _today(request)
    start = end - timedelta(days=days - 1)
    points = service.wellness_points(db, _priority(request), start, end)
    return WellnessSeries(
        start=start,
        end=end,
        points=[WellnessPoint.model_validate(p) for p in points],
        evidence=Evidence(
            level="avis_montre",
            summary=(
                "Valeurs mesurées par la montre. Training Readiness, Body Battery et la plage de "
                "référence HRV sont des avis propriétaires non validés."
            ),
        ),
    )
