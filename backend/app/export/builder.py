"""Structure intermédiaire de l'export : rien n'est inventé, une donnée absente reste `None`."""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import activities as activities_api
from app.export.glossary import GLOSSARY
from app.metrics import service
from app.metrics.fitness import FitnessReport
from app.metrics.intensity import (
    IntensityReport,
    low_share_pct,
    time_in_zones,
    zone_floors_from_profile,
)
from app.metrics.models import Evidence, Trend, monday
from app.metrics.recovery import BaselineComparison, GarminAcwr, ProprietaryMetric
from app.metrics.volume import ActivityRow, VolumeTotals, totals
from app.models import Activity, Goal, PlannedSession, SourceStatus
from app.plan.entries import read_entries
from app.plan.matching import A_VENIR
from app.plan.schemas import TYPE_LABELS, EntryOut
from app.plan.service import match_planned, status_by_id
from app.sync.dedup import primary_activities, stream_row

EXPORT_VERSION = 1  # schema_version du JSON ; à incrémenter si la structure change
MAX_SPAN_DAYS = 366
MAX_ACTIVITIES = 150
MAX_INTENSITY_WEEKS = 52

Section = Literal["profile", "activities", "plan", "recovery", "glossary"]
SECTIONS: tuple[Section, ...] = ("profile", "activities", "plan", "recovery", "glossary")


class GoalOut(BaseModel):
    nom: str
    date: date
    days_left: int
    distance_km: float | None
    dplus_m: int | None
    priorite: int


class ProfileSection(BaseModel):
    fc_max: int
    fc_repos: int | None
    seuil_lactique_fc: int | None
    zone_floors_bpm: list[int]
    updated_on: date
    goals: list[GoalOut]


class WeekVolume(BaseModel):
    week_start: date
    complete: bool
    totals: VolumeTotals


class VolumeSection(BaseModel):
    weeks: list[WeekVolume]
    total: VolumeTotals
    evidence: Evidence


class ExportActivity(BaseModel):
    id: int
    day: date
    sport: str
    source: str
    is_race: bool
    duration_min: float
    distance_km: float | None
    dplus_m: float | None
    dminus_m: float | None
    hr_avg: int | None
    hr_max: int | None
    rpe: int | None
    zone_seconds: list[float] | None  # [sous Z1, Z1, Z2, Z3, Z4, Z5]
    hr_time_s: float | None
    low_share_pct: float | None
    has_stream: bool


class PlanItem(BaseModel):
    date: date
    titre: str
    type_label: str
    duree_min: int | None
    zone_cible: str | None
    dplus_cible: int | None
    status: str
    done_min: float | None
    done_dplus_m: float | None


class FitnessSummary(BaseModel):
    date: date
    ctl: float
    atl: float
    tsb: float
    ctl_ramp_4w: float | None
    trend: Trend
    warnings: list[str]
    evidence: Evidence


class RecoverySection(BaseModel):
    as_of: date
    fallback: service.FallbackNotice | None
    baseline_days: int
    hrv: BaselineComparison
    resting_hr: BaselineComparison
    sleep_duration_h: BaselineComparison
    sleep_efficiency_pct: BaselineComparison
    training_readiness: ProprietaryMetric
    body_battery_max: ProprietaryMetric
    body_battery_min: ProprietaryMetric
    garmin_hrv_reference: tuple[date, float, float] | None
    acwr: GarminAcwr | None
    entries: list[EntryOut]
    sick_days: list[date]


class SourceInfo(BaseModel):
    source: str
    state: str
    unavailable_since: date | None
    message: str | None
    activities: int


class GlossaryItem(BaseModel):
    key: str
    name: str
    evidence: str
    text: str


class ExportData(BaseModel):
    schema_version: int = EXPORT_VERSION
    generated_on: date
    start: date
    end: date
    days: int
    sections: list[Section]
    profile: ProfileSection | None = None
    volume: VolumeSection | None = None
    intensity: IntensityReport | None = None
    fitness: FitnessSummary | None = None
    activities: list[ExportActivity] = []
    activities_truncated: int = 0
    plan: list[PlanItem] = []
    recovery: RecoverySection | None = None
    sources: list[SourceInfo] = []
    limits: list[str] = []
    glossary: list[GlossaryItem] = []
    streams_url: str | None = None  # flux sous-échantillonnés : fichier JSON séparé


class ExportError(ValueError):
    pass


def parse_scope(scope: str | None) -> list[Section]:
    if not scope or scope.strip() in ("", "all"):
        return list(SECTIONS)
    wanted = [s.strip() for s in scope.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in SECTIONS]
    if unknown:
        raise ExportError(
            f"Parties inconnues : {', '.join(unknown)}. Valeurs : {', '.join(SECTIONS)}."
        )
    return [s for s in SECTIONS if s in wanted]


def _profile(session: Session, today: date) -> ProfileSection:
    profile = service.get_profile(session)
    goals = session.scalars(select(Goal).where(Goal.date >= today).order_by(Goal.date)).all()
    return ProfileSection(
        fc_max=profile.fc_max,
        fc_repos=profile.fc_repos,
        seuil_lactique_fc=profile.seuil_lactique_fc,
        zone_floors_bpm=zone_floors_from_profile(profile.zones, profile.fc_max),
        updated_on=profile.updated_at.date(),
        goals=[
            GoalOut(
                nom=g.nom,
                date=g.date,
                days_left=(g.date - today).days,
                distance_km=g.distance_km,
                dplus_m=g.dplus_m,
                priorite=g.priorite,
            )
            for g in goals
        ],
    )


def volume_section(
    rows: Sequence[ActivityRow], start: date, end: date, today: date
) -> VolumeSection:
    by_week: dict[date, list[ActivityRow]] = defaultdict(list)
    for r in rows:
        by_week[monday(r.day)].append(r)
    weeks: list[WeekVolume] = []
    week = monday(start)
    while week <= end:
        weeks.append(
            WeekVolume(
                week_start=week,
                complete=week + timedelta(days=6) < today,
                totals=totals(by_week.get(week, [])),
            )
        )
        week += timedelta(days=7)
    return VolumeSection(
        weeks=weeks,
        total=totals(list(rows)),
        evidence=Evidence(
            level="etabli",
            summary=(
                "Volumes mesurés par la montre. Hausse de temps ≈ +10 % par semaine : repère de "
                "bon sens, jamais un prédicteur de blessure."
            ),
        ),
    )


def export_activities(
    session: Session,
    acts: Sequence[Activity],
    tz: ZoneInfo,
    floors: Sequence[int],
) -> list[ExportActivity]:
    rpe = activities_api.rpe_by_group(session)
    with_stream = {a.id for a in acts if stream_row(session, a.id) is not None}
    out: list[ExportActivity] = []
    for act in acts:
        base = activities_api.to_out(act, tz, rpe)
        zone_seconds = hr_time = share = None
        if act.id in with_stream and not act.is_race:  # FC de course non comparée aux séances
            stream = service.hr_stream(session, act.id)
            if stream is not None:
                zt = time_in_zones(stream[0], stream[1], floors)
                zone_seconds, hr_time, share = (
                    list(zt.seconds),
                    zt.hr_time_s,
                    low_share_pct(zt.seconds),
                )
        out.append(
            ExportActivity(
                id=act.id,
                day=base.day,
                sport=act.sport,
                source=act.source,
                is_race=act.is_race,
                duration_min=base.duration_min,
                distance_km=base.distance_km,
                dplus_m=base.dplus_m,
                dminus_m=base.dminus_m,
                hr_avg=act.hr_avg,
                hr_max=act.hr_max,
                rpe=base.rpe,
                zone_seconds=zone_seconds,
                hr_time_s=hr_time,
                low_share_pct=share,
                has_stream=act.id in with_stream,
            )
        )
    return out


def plan_items(
    session: Session,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
    start: date,
    end: date,
) -> list[PlanItem]:
    planned = list(
        session.scalars(
            select(PlannedSession)
            .where(PlannedSession.date >= start, PlannedSession.date <= end)
            .order_by(PlannedSession.date, PlannedSession.id)
        )
    )
    results = status_by_id(match_planned(session, priority, tz, today, planned))
    items: list[PlanItem] = []
    for p in planned:
        res = results.get(p.id)
        act = res.activity if res else None
        items.append(
            PlanItem(
                date=p.date,
                titre=p.titre,
                type_label=TYPE_LABELS.get(p.type, p.type),
                duree_min=p.duree_min,
                zone_cible=p.zone_cible,
                dplus_cible=p.dplus_cible,
                status=res.status if res else A_VENIR,
                done_min=act.duration_s / 60 if act else None,
                done_dplus_m=act.gain_m if act else None,
            )
        )
    return items


def recovery_section(
    session: Session, priority: Sequence[str], end: date, start: date, baseline_days: int
) -> RecoverySection:
    parts = service.recovery_parts(session, priority, end, baseline_days)
    entries = read_entries(session, start, end)
    return RecoverySection.model_validate(
        {
            "as_of": end,
            "fallback": service.fallback_notice(session, end),
            "baseline_days": baseline_days,
            **parts,
            "garmin_hrv_reference": service.latest_garmin_reference(session, end),
            "acwr": service.latest_acwr(session, end),
            "entries": entries,
            "sick_days": [e.date for e in entries if e.malade],
        }
    )


def fitness_summary(report: FitnessReport) -> FitnessSummary | None:
    last = report.points[-1] if report.points else None
    if last is None:
        return None
    return FitnessSummary(
        date=last.date,
        ctl=last.ctl,
        atl=last.atl,
        tsb=last.tsb,
        ctl_ramp_4w=report.ctl_ramp_4w,
        trend=report.trend,
        warnings=report.warnings,
        evidence=report.evidence,
    )


def _sources(session: Session, acts: Sequence[Activity]) -> list[SourceInfo]:
    counts: dict[str, int] = defaultdict(int)
    for a in acts:
        counts[a.source] += 1
    statuses = {s.source: s for s in session.scalars(select(SourceStatus))}
    out: list[SourceInfo] = []
    for name in dict.fromkeys([*statuses, *counts]):
        st = statuses.get(name)
        state = (st.state or ("down" if st.unavailable_since else "ok")) if st else "inconnu"
        out.append(
            SourceInfo(
                source=name,
                state=state,
                unavailable_since=st.unavailable_since.date()
                if st and st.unavailable_since
                else None,
                message=st.message if st else None,
                activities=counts.get(name, 0),
            )
        )
    return out


def _limits(data: ExportData, wellness_days: int) -> list[str]:
    limits: list[str] = []
    if data.activities_truncated:
        limits.append(
            f"{data.activities_truncated} séance(s) plus anciennes non listées (limite de "
            f"{MAX_ACTIVITIES} séances) ; les totaux les incluent."
        )
    if "activities" in data.sections:
        no_hr = sum(1 for a in data.activities if a.hr_avg is None)
        no_stream = sum(1 for a in data.activities if not a.has_stream)
        if no_hr:
            limits.append(f"{no_hr} séance(s) sans FC moyenne.")
        if no_stream:
            limits.append(f"{no_stream} séance(s) sans flux détaillé (pas de temps par zone).")
    if data.recovery is not None:
        r = data.recovery
        for label, comp in (
            ("HRV", r.hrv),
            ("FC de repos", r.resting_hr),
            ("Sommeil", r.sleep_duration_h),
        ):
            if not comp.sufficient:
                limits.append(f"{label} : données insuffisantes pour une tendance.")
        if wellness_days == 0:
            limits.append("Aucune donnée de récupération reçue sur la période.")
    if data.fitness is None and "activities" in data.sections:
        limits.append("Charge CTL/ATL/TSB indisponible : aucune séance avec FC.")
    for s in data.sources:
        if s.unavailable_since is not None:
            limits.append(
                f"Source {s.source} indisponible depuis le {s.unavailable_since.isoformat()} : "
                "dernières valeurs connues conservées."
            )
        elif s.state in ("degraded", "auth_required", "down"):
            limits.append(f"Source {s.source} : {s.message or s.state}.")
    return limits


def reversed_activities(session: Session, priority: Sequence[str]) -> list[Activity]:
    """Activités dédupliquées, de la plus récente à la plus ancienne."""
    return list(reversed(primary_activities(session, priority)))


def build_export(
    session: Session,
    *,
    start: date,
    end: date,
    scope: Sequence[Section] = SECTIONS,
    priority: Sequence[str],
    tz: ZoneInfo,
    today: date,
) -> ExportData:
    if start > end:
        raise ExportError("« from » doit précéder « to ».")
    days = (end - start).days + 1
    if days > MAX_SPAN_DAYS:
        raise ExportError(f"Période limitée à {MAX_SPAN_DAYS} jours.")
    sections = [s for s in SECTIONS if s in scope]
    data = ExportData(generated_on=today, start=start, end=end, days=days, sections=sections)

    all_rows = service.load_rows(session, priority, tz)
    rows = [r for r in all_rows if start <= r.day <= end]
    acts = [
        a
        for a in reversed(
            primary_activities(session, priority)
        )  # de la plus récente à la plus ancienne
        if start <= service.local_day(a.start_utc, tz) <= end
    ]
    data.sources = _sources(session, acts)

    if "profile" in sections:
        data.profile = _profile(session, today)
    if "activities" in sections:
        profile = service.get_profile(session)
        floors = zone_floors_from_profile(profile.zones, profile.fc_max)
        data.volume = volume_section(rows, start, end, today)
        weeks = min(MAX_INTENSITY_WEEKS, max(1, (monday(end) - monday(start)).days // 7 + 1))
        data.intensity = service.intensity(session, all_rows, end, weeks)
        data.fitness = fitness_summary(service.fitness(session, all_rows, today, start, end))
        listed = acts[:MAX_ACTIVITIES]
        data.activities_truncated = len(acts) - len(listed)
        data.activities = export_activities(session, listed, tz, floors)
    if "plan" in sections:
        data.plan = plan_items(session, priority, tz, today, start, end)
    wellness_days = 0
    if "recovery" in sections:
        data.recovery = recovery_section(session, priority, end, start, 60)
        wellness_days = len(service.wellness_points(session, priority, start, end))
    data.limits = _limits(data, wellness_days)
    if "glossary" in sections:
        data.glossary = [
            GlossaryItem(key=g.key, name=g.name, evidence=g.evidence, text=g.text) for g in GLOSSARY
        ]
    return data
