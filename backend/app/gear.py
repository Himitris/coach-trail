"""Matériel : kilométrage par paire de chaussures, seuil d'usure réglable, alerte douce.

Une sortie compte pour une paire dans cet ordre : affectation manuelle > matériel fourni par la
montre ou la source (champ `gear` de la sortie, fusionné entre sources) > non affectée. Chaque
séance réelle n'est comptée qu'une fois (déduplication). Km total = km déjà parcourus avant l'appli
+ km des sorties affectées. Seuil : repère personnel (800 km par défaut) ; la durée de vie réelle
varie beaucoup (terrain, poids, foulée), l'alerte est donc seulement informative.
"""

from collections.abc import Sequence
from datetime import date
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.models import Evidence
from app.metrics.service import local_day
from app.models import Activity, GearAssignment, GearItem
from app.plan.matching import RUN_SPORTS
from app.sync.dedup import primary_activities

DEFAULT_THRESHOLD_KM = 800
WATCH_RATIO = 0.9
Status = Literal["ok", "surveiller", "atteint", "retire"]


class GearOut(BaseModel):
    id: int | None  # None : nom vu dans les sorties, pas encore enregistré
    nom: str
    registered: bool
    seuil_km: int
    km_initial: float
    km_total: float
    km_activities: float
    activities: int
    last_used: date | None
    usage_pct: float
    status: Status
    message: str | None


class UnassignedRun(BaseModel):
    activity_id: int
    day: date
    sport: str
    distance_km: float | None


class GearReport(BaseModel):
    items: list[GearOut]
    unassigned: list[UnassignedRun]
    unassigned_total: int
    evidence: Evidence


def status_for(km: float, threshold: int, retired: bool) -> tuple[Status, str | None]:
    if retired:
        return "retire", None
    pct = km / threshold if threshold else 0.0
    if pct >= 1:
        return "atteint", (
            f"Seuil de {threshold} km atteint ({km:.0f} km) : information, pas une obligation. "
            "L'usure réelle dépend du terrain et de la foulée ; vérifiez l'état de la semelle."
        )
    if pct >= WATCH_RATIO:
        return "surveiller", (
            f"Environ {pct * 100:.0f} % du seuil de {threshold} km : à surveiller. "
            "Repère personnel, l'usure réelle varie."
        )
    return "ok", None


def build_report(
    session: Session, priority: Sequence[str], tz_name: str, *, unassigned_limit: int = 15
) -> GearReport:
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(tz_name)
    items = {g.id: g for g in session.scalars(select(GearItem))}
    by_name = {g.nom: g for g in items.values()}
    group_of = {a.id: (a.dedup_group_id or a.id) for a in session.scalars(select(Activity))}
    manual = {
        group_of.get(a.activity_id, a.activity_id): a.gear_id
        for a in session.scalars(select(GearAssignment))
    }
    km: dict[str, float] = {}
    count: dict[str, int] = {}
    last: dict[str, date] = {}
    unassigned: list[UnassignedRun] = []
    for act in primary_activities(session, priority):
        key = group_of.get(act.id, act.id)
        name: str | None = None
        if key in manual and manual[key] in items:
            name = items[manual[key]].nom
        elif act.gear:
            name = act.gear
        day = local_day(act.start_utc, tz)
        if name is None:
            if act.sport in RUN_SPORTS:
                unassigned.append(
                    UnassignedRun(
                        activity_id=act.id,
                        day=day,
                        sport=act.sport,
                        distance_km=act.distance_m / 1000 if act.distance_m else None,
                    )
                )
            continue
        km[name] = km.get(name, 0.0) + (act.distance_m or 0.0) / 1000
        count[name] = count.get(name, 0) + 1
        last[name] = max(last.get(name, day), day)

    out: list[GearOut] = []
    for name in sorted(set(by_name) | set(km), key=str.lower):
        item = by_name.get(name)
        threshold = item.seuil_km if item else DEFAULT_THRESHOLD_KM
        initial = item.km_initial if item else 0.0
        total = initial + km.get(name, 0.0)
        status, message = status_for(total, threshold, bool(item and item.retire))
        out.append(
            GearOut(
                id=item.id if item else None,
                nom=name,
                registered=item is not None,
                seuil_km=threshold,
                km_initial=initial,
                km_total=total,
                km_activities=km.get(name, 0.0),
                activities=count.get(name, 0),
                last_used=last.get(name),
                usage_pct=total / threshold * 100 if threshold else 0.0,
                status=status,
                message=message,
            )
        )
    unassigned.sort(key=lambda u: (u.day, u.activity_id), reverse=True)
    return GearReport(
        items=out,
        unassigned=unassigned[:unassigned_limit],
        unassigned_total=len(unassigned),
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Kilométrage cumulé des sorties affectées à chaque paire (matériel de la montre ou "
                "affectation manuelle). Le seuil d'usure est un repère personnel : la durée de vie "
                "réelle dépend du terrain, du poids et de la foulée."
            ),
        ),
    )
