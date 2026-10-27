"""Nutrition en course : glucides par heure réellement consommés et score digestif (0–5).

L'appli enregistre, elle ne prescrit : aucune cible n'est affichée comme « bonne » ou « mauvaise ».
La série suit la montée progressive (gut training) sur les sorties longues (durée > 2,5 h par
défaut) : variation des glucides/h par rapport à la sortie longue renseignée précédente.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel

from app.metrics.models import Evidence

DEFAULT_MIN_HOURS = 2.5


@dataclass(frozen=True)
class Outing:
    activity_id: int
    day: date
    duration_s: float
    distance_km: float | None
    entry_id: int | None = None
    carbs_g_per_h: float | None = None
    gi_score: int | None = None
    note: str | None = None


class FuelingPoint(BaseModel):
    activity_id: int
    day: date
    duration_h: float
    distance_km: float | None
    entry_id: int | None
    carbs_g_per_h: float | None
    carbs_total_g: float | None
    gi_score: int | None
    note: str | None
    carbs_change_g_per_h: float | None  # vs sortie longue renseignée précédente


class FuelingSeries(BaseModel):
    min_hours: float
    points: list[FuelingPoint]
    missing: int  # sorties longues sans saisie
    evidence: Evidence


def fueling_series(
    outings: Sequence[Outing], min_hours: float = DEFAULT_MIN_HOURS
) -> FuelingSeries:
    long_outings = sorted(
        (o for o in outings if o.duration_s / 3600 > min_hours),
        key=lambda o: (o.day, o.activity_id),
    )
    points: list[FuelingPoint] = []
    previous: float | None = None
    for o in long_outings:
        hours = o.duration_s / 3600
        change = None
        if o.carbs_g_per_h is not None:
            if previous is not None:
                change = o.carbs_g_per_h - previous
            previous = o.carbs_g_per_h
        points.append(
            FuelingPoint(
                activity_id=o.activity_id,
                day=o.day,
                duration_h=hours,
                distance_km=o.distance_km,
                entry_id=o.entry_id,
                carbs_g_per_h=o.carbs_g_per_h,
                carbs_total_g=None if o.carbs_g_per_h is None else o.carbs_g_per_h * hours,
                gi_score=o.gi_score,
                note=o.note,
                carbs_change_g_per_h=change,
            )
        )
    return FuelingSeries(
        min_hours=min_hours,
        points=points,
        missing=sum(1 for p in points if p.entry_id is None),
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Saisies de l'athlète. Les revues citent 90 g/h au-delà de 2,5–3 h (jusqu'à "
                "120 g/h testés chez des élites) et des troubles digestifs fréquents : l'appli "
                "suit la montée progressive, elle ne fixe aucune cible."
            ),
        ),
    )
