from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Activity, ActivityStream

START_TOLERANCE_S = 60
DURATION_TOLERANCE = 0.05


def _similar(a: Activity, b: Activity) -> bool:
    if a.source == b.source:
        return False
    if abs((a.start_utc - b.start_utc).total_seconds()) > START_TOLERANCE_S:
        return False
    longest = max(a.duration_s, b.duration_s)
    return longest == 0 or abs(a.duration_s - b.duration_s) <= DURATION_TOLERANCE * longest


def assign_dedup_groups(session: Session) -> None:
    """Recalcule `dedup_group_id` (= plus petit id du groupe) ; déterministe et idempotent.

    Deux activités de sources différentes sont dans le même groupe si leur début est à ±60 s
    et leur durée à ±5 %. Deux activités d'une même source ne sont jamais fusionnées.
    """
    activities = list(session.scalars(select(Activity).order_by(Activity.start_utc, Activity.id)))
    clusters: list[list[Activity]] = []
    open_clusters: list[list[Activity]] = []
    window = timedelta(seconds=START_TOLERANCE_S)
    for act in activities:
        open_clusters = [c for c in open_clusters if c[-1].start_utc >= act.start_utc - window]
        target = next(
            (
                c
                for c in open_clusters
                if all(m.source != act.source for m in c) and any(_similar(m, act) for m in c)
            ),
            None,
        )
        if target is None:
            new = [act]
            clusters.append(new)
            open_clusters.append(new)
        else:
            target.append(act)
    for cluster in clusters:
        group_id = min(a.id for a in cluster)
        for act in cluster:
            if act.dedup_group_id != group_id:
                act.dedup_group_id = group_id


# Champs que la version prioritaire peut recevoir d'une autre source du même groupe.
FILLABLE = (
    "distance_m",
    "elevation_gain_m",
    "elevation_loss_m",
    "hr_avg",
    "hr_max",
    "calories",
    "gear",
)


def _merged(members: Sequence[Activity]) -> Activity:
    """Version prioritaire ; ses champs vides sont comblés par les autres sources du groupe.

    Copie hors session : la base n'est jamais modifiée (chaque source garde ses propres valeurs).
    """
    best = members[0]
    missing = [f for f in FILLABLE if getattr(best, f) is None]
    race = any(m.is_race for m in members)
    donors = {
        f: next((getattr(m, f) for m in members[1:] if getattr(m, f) is not None), None)
        for f in missing
    }
    if race == best.is_race and all(v is None for v in donors.values()):
        return best
    merged = Activity(**{c.key: getattr(best, c.key) for c in Activity.__table__.columns})
    for field, value in donors.items():
        if value is not None:
            setattr(merged, field, value)
    merged.is_race = race
    return merged


def primary_activities(session: Session, priority: Sequence[str]) -> list[Activity]:
    """Une activité par groupe : celle de la source la plus prioritaire, champs vides comblés."""

    def rank(a: Activity) -> tuple[int, int]:
        idx = priority.index(a.source) if a.source in priority else len(priority)
        return (idx, a.id)

    groups: dict[int, list[Activity]] = {}
    for act in session.scalars(select(Activity)):
        key = act.dedup_group_id if act.dedup_group_id is not None else act.id
        groups.setdefault(key, []).append(act)
    best = [_merged(sorted(members, key=rank)) for members in groups.values()]
    return sorted(best, key=lambda a: (a.start_utc, a.id))


def stream_row(session: Session, activity_id: int) -> ActivityStream | None:
    """Flux de l'activité ou, à défaut, celui d'une autre source du même groupe (repli)."""
    row = session.get(ActivityStream, activity_id)
    if row is not None:
        return row
    act = session.get(Activity, activity_id)
    if act is None or act.dedup_group_id is None:
        return None
    return session.scalars(
        select(ActivityStream)
        .join(Activity, Activity.id == ActivityStream.activity_id)
        .where(Activity.dedup_group_id == act.dedup_group_id, Activity.id != activity_id)
        .order_by(Activity.id)
    ).first()
