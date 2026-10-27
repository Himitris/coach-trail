"""Sorties : liste et détail (profil, FC, allure, zones, côtes). Lecture de la base locale."""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.climbs import Climb, detect_climbs
from app.metrics.intensity import low_share_pct, time_in_zones, zone_floors_from_profile
from app.metrics.models import Evidence
from app.metrics.series import downsample, pace_from_speed
from app.metrics.service import get_profile, local_day
from app.models import Activity, EveningEntry
from app.routes.deps import get_db
from app.sync.dedup import primary_activities, stream_row
from app.sync.streams import decode_stream

router = APIRouter(prefix="/activities")

MAX_STREAM_POINTS = 500
MAX_SPAN_DAYS = 800

SportGroup = Literal["run", "trail", "other"]
RUN_SPORTS = frozenset({"running", "treadmill_running", "track_running", "virtual_run"})
TRAIL_SPORTS = frozenset({"trail_running", "ultra_run"})


def sport_group(sport: str) -> SportGroup:
    if sport in TRAIL_SPORTS:
        return "trail"
    if sport in RUN_SPORTS:
        return "run"
    return "other"


class ActivityOut(BaseModel):
    id: int
    source: str
    sport: str
    sport_group: SportGroup
    start_utc: datetime
    day: date
    duration_min: float
    distance_km: float | None
    dplus_m: float | None
    dminus_m: float | None
    dplus_per_km: float | None
    hr_avg: int | None
    hr_max: int | None
    calories: int | None
    is_race: bool
    rpe: int | None
    pace_s_per_km: float | None  # allure moyenne (durée totale / distance)
    gap_s_per_km: float | None  # allure ajustée à la pente : pas encore calculée (phase 2)


class StreamOut(BaseModel):
    points_total: int
    t: list[float | None]
    distance_km: list[float | None]
    altitude_m: list[float | None]
    hr: list[float | None]
    pace_s_per_km: list[float | None]


class ZonesOut(BaseModel):
    floors_bpm: list[int]
    seconds: list[float]  # [sous Z1, Z1, Z2, Z3, Z4, Z5]
    hr_time_s: float
    low_share_pct: float | None


class ActivityDetailOut(ActivityOut):
    stream: StreamOut | None
    zones: ZonesOut | None
    climbs: list[Climb]
    notes: list[str]
    evidence: Evidence


def rpe_by_group(session: Session) -> dict[int, int]:
    """RPE saisi par séance réelle (clé = groupe de déduplication, ou id si seul)."""
    rows = session.execute(
        select(EveningEntry.rpe, Activity.dedup_group_id, Activity.id)
        .join(Activity, Activity.id == EveningEntry.activity_id)
        .where(EveningEntry.kind == "session", EveningEntry.rpe.is_not(None))
    ).all()
    return {(group or aid): rpe for rpe, group, aid in rows if rpe is not None}


def to_out(act: Activity, tz: ZoneInfo, rpe: dict[int, int]) -> ActivityOut:
    distance_km = act.distance_m / 1000 if act.distance_m else None
    gain = act.elevation_gain_m
    return ActivityOut(
        id=act.id,
        source=act.source,
        sport=act.sport,
        sport_group=sport_group(act.sport),
        start_utc=act.start_utc,
        day=local_day(act.start_utc, tz),
        duration_min=act.duration_s / 60,
        distance_km=distance_km,
        dplus_m=gain,
        dminus_m=act.elevation_loss_m,
        dplus_per_km=gain / distance_km if gain is not None and distance_km else None,
        hr_avg=act.hr_avg,
        hr_max=act.hr_max,
        calories=act.calories,
        is_race=act.is_race,
        rpe=rpe.get(act.dedup_group_id or act.id),
        pace_s_per_km=act.duration_s / distance_km if distance_km else None,
        gap_s_per_km=None,
    )


def _ctx(request: Request) -> tuple[Sequence[str], ZoneInfo]:
    settings = request.app.state.settings
    return settings.priority_list, ZoneInfo(settings.tz)


@router.get("", response_model=list[ActivityOut])
def list_activities(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    group: Literal["all", "run", "trail", "other"] = "all",
    races_only: bool = False,
) -> list[ActivityOut]:
    """Sorties dédupliquées (source la plus prioritaire), de la plus récente à la plus ancienne."""
    priority, tz = _ctx(request)
    if from_ and to and (to - from_).days > MAX_SPAN_DAYS:
        raise HTTPException(422, f"Période limitée à {MAX_SPAN_DAYS} jours.")
    if from_ and to and from_ > to:
        raise HTTPException(422, "« from » doit précéder « to ».")
    rpe = rpe_by_group(db)
    out: list[ActivityOut] = []
    for act in reversed(primary_activities(db, priority)):
        item = to_out(act, tz, rpe)
        if from_ and item.day < from_:
            continue
        if to and item.day > to:
            continue
        if group != "all" and item.sport_group != group:
            continue
        if races_only and not item.is_race:
            continue
        out.append(item)
        if len(out) >= limit:
            break
    return out


@router.get("/{activity_id}", response_model=ActivityDetailOut)
def activity_detail(
    activity_id: int, request: Request, db: Annotated[Session, Depends(get_db)]
) -> ActivityDetailOut:
    _, tz = _ctx(request)
    act = db.get(Activity, activity_id)
    if act is None:
        raise HTTPException(404, "Sortie introuvable.")
    base = to_out(act, tz, rpe_by_group(db))
    notes = ["Allure ajustée à la pente (GAP) non disponible : calcul prévu en phase 2."]
    stream_out: StreamOut | None = None
    zones_out: ZonesOut | None = None
    climbs: list[Climb] = []

    row = stream_row(db, act.id)
    if row is None:
        notes.append("Pas de flux seconde par seconde pour cette sortie.")
    else:
        s = decode_stream(row.samples)
        t, hr, alt = s.get("t", []), s.get("fc", []), s.get("altitude", [])
        speed = s.get("speed", [])
        dist = s.get("distance", [])
        if not dist and speed and t:
            dist = _integrate_distance(t, speed)
        down = downsample(
            {
                "t": t,
                "distance": dist or [None] * len(t),
                "altitude": alt or [None] * len(t),
                "hr": hr or [None] * len(t),
                "speed": speed or [None] * len(t),
            },
            MAX_STREAM_POINTS,
        )
        # allure = moyenne de la vitesse du paquet (pas la moyenne des allures)
        stream_out = StreamOut(
            points_total=len(t),
            t=down["t"],
            distance_km=[d / 1000 if d is not None else None for d in down["distance"]],
            altitude_m=down["altitude"],
            hr=down["hr"],
            pace_s_per_km=[pace_from_speed(v) for v in down["speed"]],
        )
        if hr:
            profile = get_profile(db)
            floors = zone_floors_from_profile(profile.zones, profile.fc_max)
            zt = time_in_zones(t, hr, floors)
            zones_out = ZonesOut(
                floors_bpm=floors,
                seconds=list(zt.seconds),
                hr_time_s=zt.hr_time_s,
                low_share_pct=low_share_pct(zt.seconds),
            )
            if act.is_race:
                notes.append("Course : la FC de compétition n'est pas comparée aux séances.")
        else:
            notes.append("Pas de FC dans le flux : temps par zone indisponible.")
        if dist and alt:
            climbs = detect_climbs(dist, alt, t, hr)
        else:
            notes.append("Pas d'altitude ou de distance : découpage par côte indisponible.")

    return ActivityDetailOut(
        **base.model_dump(),
        stream=stream_out,
        zones=zones_out,
        climbs=climbs,
        notes=notes,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Profil, FC et zones viennent de la montre ; les côtes sont détectées sur le "
                "profil lissé (dénivelé ≥ 50 m, pente ≥ 3 %) : ordre de grandeur, pas une mesure."
            ),
        ),
    )


def _integrate_distance(
    t: Sequence[float | None], speed: Sequence[float | None]
) -> list[float | None]:
    """Distance cumulée (m) reconstruite depuis la vitesse quand le flux n'en fournit pas."""
    total = 0.0
    out: list[float | None] = []
    for i, (ti, v) in enumerate(zip(t, speed, strict=False)):
        if i > 0 and ti is not None and t[i - 1] is not None and v is not None:
            total += max(0.0, ti - float(t[i - 1] or 0)) * v
        out.append(total)
    return out
