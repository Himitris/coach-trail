"""Monotonie et tension d'entraînement (Foster).

Sur une semaine (lundi–dimanche), avec les 7 charges quotidiennes (jours de repos = 0) :

    monotonie = moyenne des charges ÷ écart-type des charges   (écart-type de la population, n = 7)
    tension   = charge de la semaine (somme) × monotonie

Monotonie indéfinie (None) si l'écart-type est nul (7 jours identiques, dont une semaine sans
charge). Repère : 2 (valeur d'attention de la littérature). « Charge élevée » = charge de la
semaine supérieure de plus de 10 % à la moyenne des 4 semaines précédentes (au moins 2 semaines
d'historique). L'alerte douce se déclenche si monotonie > 2 ET charge élevée ; elle informe, elle
ne prédit rien.

Niveau de preuve : observationnel, petit échantillon (25 athlètes) ; association avec des maladies,
jamais un prédicteur de blessure.
"""

import math
from collections.abc import Mapping, Sequence
from datetime import date, timedelta

from pydantic import BaseModel

from app.metrics.models import Evidence, monday

MONOTONY_REFERENCE = 2.0
HIGH_LOAD_FACTOR = 1.10
HIGH_LOAD_HISTORY_WEEKS = 4
HIGH_LOAD_MIN_WEEKS = 2


class MonotonyWeek(BaseModel):
    week_start: date
    complete: bool
    load: float
    monotony: float | None
    strain: float | None
    high_load: bool | None  # None : historique insuffisant
    soft_alert: bool
    message: str | None


class MonotonyReport(BaseModel):
    reference: float = MONOTONY_REFERENCE
    weeks: list[MonotonyWeek]
    evidence: Evidence


def week_stats(loads: Sequence[float]) -> tuple[float, float | None, float | None]:
    """(charge, monotonie, tension) d'une semaine de 7 charges quotidiennes."""
    total = float(sum(loads))
    mean = total / len(loads)
    sd = math.sqrt(sum((x - mean) ** 2 for x in loads) / len(loads))
    if sd < 1e-9:
        return total, None, None
    monotony = mean / sd
    return total, monotony, total * monotony


def monotony_report(
    daily_load: Mapping[date, float],
    first_day: date | None,
    last_week_of: date,
    today: date,
    weeks: int,
) -> MonotonyReport:
    """Série hebdomadaire des `weeks` dernières semaines (la dernière contient `last_week_of`)."""
    last = monday(last_week_of)
    starts = [
        last - timedelta(days=7 * k) for k in range(weeks - 1 + HIGH_LOAD_HISTORY_WEEKS, -1, -1)
    ]
    totals: dict[date, float] = {}
    out: list[MonotonyWeek] = []
    for start in starts:
        loads = [daily_load.get(start + timedelta(days=d), 0.0) for d in range(7)]
        load, monotony, strain = week_stats(loads)
        totals[start] = load
        if start < last - timedelta(days=7 * (weeks - 1)):
            continue  # semaines d'échauffement, uniquement pour la référence de charge
        has_data = first_day is not None and start + timedelta(days=6) >= first_day
        previous = [
            totals[start - timedelta(days=7 * k)]
            for k in range(1, HIGH_LOAD_HISTORY_WEEKS + 1)
            if start - timedelta(days=7 * k) in totals
            and first_day is not None
            and start - timedelta(days=7 * k) + timedelta(days=6) >= first_day
        ]
        high: bool | None = None
        if len(previous) >= HIGH_LOAD_MIN_WEEKS:
            high = load > HIGH_LOAD_FACTOR * (sum(previous) / len(previous))
        alert = bool(monotony is not None and monotony > MONOTONY_REFERENCE and high)
        out.append(
            MonotonyWeek(
                week_start=start,
                complete=start + timedelta(days=6) < today,
                load=load,
                monotony=monotony if has_data else None,
                strain=strain if has_data else None,
                high_load=high,
                soft_alert=alert,
                message=(
                    "Charge élevée et peu de variation d'un jour à l'autre cette semaine : "
                    "information seulement, variez les jours faciles et difficiles si possible."
                    if alert
                    else None
                ),
            )
        )
    return MonotonyReport(
        weeks=out,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Monotonie (moyenne ÷ écart-type des charges quotidiennes) et tension : données "
                "observationnelles sur un petit échantillon (25 athlètes), associées à des "
                "maladies. Information et alerte douce, jamais un prédicteur de blessure."
            ),
        ),
    )
