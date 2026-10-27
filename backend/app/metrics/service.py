"""Lecture des tables normalisées -> entrées des fonctions pures de `app.metrics`."""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.fitness import (
    STALE_PROFILE_DAYS,
    FitnessReport,
    fitness_report,
    hr_params,
    load_from_average,
    load_from_stream,
)
from app.metrics.intensity import (
    ActivityZones,
    IntensityReport,
    intensity_report,
    time_in_zones,
    zone_floors_from_profile,
)
from app.metrics.models import Evidence, monday
from app.metrics.recovery import (
    BaselineComparison,
    GarminAcwr,
    ProprietaryMetric,
    baseline_comparison,
    garmin_acwr,
    proprietary_metric,
)
from app.metrics.volume import ActivityRow
from app.models import ActivityStream, AthleteProfile, RawPayload, WellnessDaily
from app.sync.dedup import primary_activities
from app.sync.streams import decode_stream


def local_day(start_utc: datetime, tz: ZoneInfo) -> date:
    return start_utc.replace(tzinfo=UTC).astimezone(tz).date()


def load_rows(session: Session, priority: Sequence[str], tz: ZoneInfo) -> list[ActivityRow]:
    """Activités dédupliquées (source la plus prioritaire de chaque groupe), jour local."""
    return [
        ActivityRow(
            id=a.id,
            day=local_day(a.start_utc, tz),
            start_utc=a.start_utc,
            sport=a.sport,
            duration_s=a.duration_s,
            distance_m=a.distance_m,
            gain_m=a.elevation_gain_m,
            loss_m=a.elevation_loss_m,
            hr_avg=a.hr_avg,
            hr_max=a.hr_max,
            is_race=a.is_race,
        )
        for a in primary_activities(session, priority)
    ]


def hr_stream(
    session: Session, activity_id: int
) -> tuple[list[float | None], list[float | None]] | None:
    row = session.get(ActivityStream, activity_id)
    if row is None:
        return None
    samples = decode_stream(row.samples)
    t, hr = samples.get("t"), samples.get("fc")
    return (t, hr) if t and hr else None


def get_profile(session: Session) -> AthleteProfile:
    profile = session.get(AthleteProfile, 1)
    if profile is None:
        raise RuntimeError("Profil absent : migrations non appliquées ?")
    return profile


# --- intensité ------------------------------------------------------------------------------


def intensity(
    session: Session, rows: Sequence[ActivityRow], today: date, weeks: int
) -> IntensityReport:
    profile = get_profile(session)
    floors = zone_floors_from_profile(profile.zones, profile.fc_max)
    first = monday(today) - timedelta(days=7 * (weeks - 1))
    items: list[ActivityZones] = []
    for row in rows:
        if row.day < first:
            continue
        if row.is_race:
            items.append(ActivityZones(row.day, True, None))
            continue
        stream = hr_stream(session, row.id)
        zones = time_in_zones(stream[0], stream[1], floors) if stream else None
        items.append(ActivityZones(row.day, False, zones))
    return intensity_report(items, floors, today, weeks)


# --- forme / charge -------------------------------------------------------------------------


def fitness(
    session: Session, rows: Sequence[ActivityRow], today: date, start: date, end: date
) -> FitnessReport:
    profile = get_profile(session)
    params, notes = hr_params(profile.fc_max, profile.fc_repos, profile.seuil_lactique_fc)
    age_days = (datetime.now(UTC).replace(tzinfo=None) - profile.updated_at).days
    if age_days > STALE_PROFILE_DAYS:
        notes.append(
            f"Profil (FC repos, seuil lactique, zones) non mis à jour depuis {age_days} jours : "
            "le seuil de FC est peut-être ancien."
        )
    daily: dict[date, float] = {}
    first_day: date | None = None
    estimated = without_hr = 0
    for row in rows:
        if row.day > end:
            continue
        load = 0.0
        stream = hr_stream(session, row.id)
        if stream is not None:
            load, covered = load_from_stream(stream[0], stream[1], params)
            if covered <= 0:
                stream = None
        if stream is None:
            if row.hr_avg:
                load = load_from_average(row.duration_s, row.hr_avg, params)
                estimated += 1
            else:
                without_hr += 1
                continue
        daily[row.day] = daily.get(row.day, 0.0) + load
        first_day = row.day if first_day is None else min(first_day, row.day)
    if estimated:
        notes.append(f"{estimated} séance(s) sans flux de FC : charge estimée avec la FC moyenne.")
    if without_hr:
        notes.append(f"{without_hr} séance(s) sans donnée de FC ignorée(s) dans la charge.")
    return fitness_report(daily, first_day, start, end, notes)


# --- récupération ---------------------------------------------------------------------------

WELLNESS_FIELDS = (
    "hrv_nuit",
    "hrv_base_min",
    "hrv_base_max",
    "fc_repos",
    "sommeil_duree_s",
    "sommeil_efficacite",
    "training_readiness",
    "body_battery_max",
    "body_battery_min",
)


def wellness_series(
    session: Session, priority: Sequence[str]
) -> dict[str, dict[date, float | None]]:
    """Par champ et par jour : valeur de la source la plus prioritaire qui l'a renseignée."""

    def rank(source: str) -> int:
        return priority.index(source) if source in priority else len(priority)

    best: dict[str, dict[date, tuple[int, float]]] = {f: {} for f in WELLNESS_FIELDS}
    for row in session.scalars(select(WellnessDaily)):
        r = rank(row.source)
        for field in WELLNESS_FIELDS:
            value = getattr(row, field)
            if value is None:
                continue
            current = best[field].get(row.date)
            if current is None or r < current[0]:
                best[field][row.date] = (r, float(value))
    return {f: {d: v for d, (_, v) in days.items()} for f, days in best.items()}


def latest_garmin_reference(session: Session, end: date) -> tuple[date, float, float] | None:
    row = session.scalars(
        select(WellnessDaily)
        .where(
            WellnessDaily.date <= end,
            WellnessDaily.hrv_base_min.is_not(None),
            WellnessDaily.hrv_base_max.is_not(None),
        )
        .order_by(WellnessDaily.date.desc())
    ).first()
    if row is None or row.hrv_base_min is None or row.hrv_base_max is None:
        return None
    return row.date, row.hrv_base_min, row.hrv_base_max


def latest_acwr(session: Session, end: date) -> GarminAcwr | None:
    raws = session.scalars(
        select(RawPayload)
        .where(RawPayload.type == "wellness", RawPayload.external_key <= end.isoformat())
        .order_by(RawPayload.external_key.desc())
        .limit(14)
    )
    for raw in raws:
        status = raw.payload.get("training_status")
        if status:
            acwr = garmin_acwr(status, date.fromisoformat(raw.external_key))
            if acwr is not None:
                return acwr
    return None


def recovery_parts(
    session: Session, priority: Sequence[str], end: date, baseline_days: int
) -> dict[str, BaselineComparison | ProprietaryMetric]:
    series = wellness_series(session, priority)
    sleep_h = {
        d: (v / 3600 if v is not None else None) for d, v in series["sommeil_duree_s"].items()
    }
    ev_hrv = Evidence(
        level="indicatif",
        summary=(
            "HRV nocturne : moyenne 7 j comparée à la base individuelle, en tendance. "
            "Pas de seuil quotidien feu vert/rouge : une nuit isolée ne dit rien."
        ),
    )
    ev_rhr = Evidence(
        level="indicatif",
        summary="FC de repos : moyenne 7 j vs base individuelle ; lecture en tendance uniquement.",
    )
    ev_sleep = Evidence(
        level="indicatif",
        summary=(
            "Sommeil mesuré par la montre (durée ; efficacité = temps endormi / fenêtre estimée)."
        ),
    )
    return {
        "hrv": baseline_comparison(
            series["hrv_nuit"], end, baseline_days=baseline_days, evidence=ev_hrv
        ),
        "resting_hr": baseline_comparison(
            series["fc_repos"], end, baseline_days=baseline_days, evidence=ev_rhr
        ),
        "sleep_duration_h": baseline_comparison(
            sleep_h, end, baseline_days=baseline_days, evidence=ev_sleep
        ),
        "sleep_efficiency_pct": baseline_comparison(
            series["sommeil_efficacite"], end, baseline_days=baseline_days, evidence=ev_sleep
        ),
        "training_readiness": proprietary_metric(
            series["training_readiness"], end, "Training Readiness"
        ),
        "body_battery_max": proprietary_metric(
            series["body_battery_max"], end, "Body Battery (max)"
        ),
        "body_battery_min": proprietary_metric(
            series["body_battery_min"], end, "Body Battery (min)"
        ),
    }


def wellness_points(
    session: Session, priority: Sequence[str], start: date, end: date
) -> list[dict[str, float | date | None]]:
    """Jours renseignés entre `start` et `end` (aucun jour inventé), par source prioritaire."""
    series = wellness_series(session, priority)
    days = sorted({d for field in series.values() for d in field if start <= d <= end})
    points: list[dict[str, float | date | None]] = []
    for day in days:
        duration = series["sommeil_duree_s"].get(day)
        points.append(
            {
                "date": day,
                "hrv_nuit": series["hrv_nuit"].get(day),
                "hrv_base_min": series["hrv_base_min"].get(day),
                "hrv_base_max": series["hrv_base_max"].get(day),
                "fc_repos": series["fc_repos"].get(day),
                "sommeil_duree_h": duration / 3600 if duration is not None else None,
                "sommeil_efficacite": series["sommeil_efficacite"].get(day),
                "training_readiness": series["training_readiness"].get(day),
                "body_battery_max": series["body_battery_max"].get(day),
                "body_battery_min": series["body_battery_min"].get(day),
            }
        )
    return points
