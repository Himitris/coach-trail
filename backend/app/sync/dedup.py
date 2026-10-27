from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Activity

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


def primary_activities(session: Session, priority: Sequence[str]) -> list[Activity]:
    """Une activité par groupe : celle de la source la plus prioritaire."""

    def rank(a: Activity) -> tuple[int, int]:
        idx = priority.index(a.source) if a.source in priority else len(priority)
        return (idx, a.id)

    best: dict[int, Activity] = {}
    for act in session.scalars(select(Activity)):
        key = act.dedup_group_id if act.dedup_group_id is not None else act.id
        if key not in best or rank(act) < rank(best[key]):
            best[key] = act
    return sorted(best.values(), key=lambda a: (a.start_utc, a.id))
