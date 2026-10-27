"""Récupération : moyenne 7 j vs base 30–60 j, sans seuil feu vert/rouge.

HRV, FC repos et sommeil sont comparés à leur base individuelle (jours précédant la fenêtre de
7 jours). L'écart est donné en valeur, en % et en écart-type ; la « tendance » est un simple
libellé (hausse / stable / baisse, stable si |écart| < 0,5 écart-type, le plus petit changement
utile usuel). Training Readiness et Body Battery sont des avis propriétaires repris tels quels.
"""

import math
from collections.abc import Mapping
from datetime import date, timedelta
from typing import Any

from pydantic import BaseModel

from app.metrics.models import Evidence, Trend, mean, pct_change

RECENT_DAYS = 7
MIN_BASELINE_DAYS = 30
MAX_BASELINE_DAYS = 60
MIN_RECENT_N = 4  # sur 7 jours
MIN_BASELINE_N = 20
STABLE_SD = 0.5
PROPRIETARY_LABEL = "avis Garmin, non validé"


class BaselineComparison(BaseModel):
    recent_mean: float | None
    recent_n: int
    baseline_mean: float | None
    baseline_sd: float | None
    baseline_n: int
    baseline_days: int
    delta: float | None
    delta_pct: float | None
    delta_sd: float | None
    sufficient: bool
    trend: Trend
    evidence: Evidence


def _window(series: Mapping[date, float | None], first: date, last: date) -> list[float]:
    out: list[float] = []
    day = first
    while day <= last:
        v = series.get(day)
        if v is not None:
            out.append(v)
        day += timedelta(days=1)
    return out


def baseline_comparison(
    series: Mapping[date, float | None],
    end: date,
    *,
    baseline_days: int = MAX_BASELINE_DAYS,
    evidence: Evidence,
    window_label: str = "moyenne 7 j vs base",
) -> BaselineComparison:
    baseline_days = min(max(baseline_days, MIN_BASELINE_DAYS), MAX_BASELINE_DAYS)
    recent_first = end - timedelta(days=RECENT_DAYS - 1)
    recent = _window(series, recent_first, end)
    base = _window(
        series, recent_first - timedelta(days=baseline_days), recent_first - timedelta(days=1)
    )

    recent_mean = mean(recent)
    base_mean = mean(base)
    sd: float | None = None
    if len(base) >= 2 and base_mean is not None:
        sd = math.sqrt(sum((v - base_mean) ** 2 for v in base) / (len(base) - 1))
    sufficient = len(recent) >= MIN_RECENT_N and len(base) >= MIN_BASELINE_N
    delta = recent_mean - base_mean if recent_mean is not None and base_mean is not None else None
    delta_sd = delta / sd if delta is not None and sd else None

    window = f"{window_label} {baseline_days} j"
    if not sufficient or delta is None:
        trend = Trend(direction="indetermine", delta=delta, window=window)
    else:
        if delta == 0 or (delta_sd is not None and abs(delta_sd) < STABLE_SD):
            direction = "stable"
        else:
            direction = "hausse" if delta > 0 else "baisse"
        trend = Trend(
            direction=direction,
            delta=delta,
            delta_pct=pct_change(recent_mean, base_mean),
            window=window,
        )
    return BaselineComparison(
        recent_mean=recent_mean,
        recent_n=len(recent),
        baseline_mean=base_mean,
        baseline_sd=sd,
        baseline_n=len(base),
        baseline_days=baseline_days,
        delta=delta,
        delta_pct=pct_change(recent_mean, base_mean),
        delta_sd=delta_sd if sufficient else None,
        sufficient=sufficient,
        trend=trend,
        evidence=evidence
        if sufficient
        else Evidence(
            level="indicatif",
            summary=evidence.summary
            + f" Données insuffisantes (≥ {MIN_RECENT_N} nuits récentes et ≥ {MIN_BASELINE_N} "
            "jours de base requis) : tendance non établie.",
        ),
    )


class ProprietaryMetric(BaseModel):
    """Indicateur du fabricant, repris tel quel (jamais recombiné)."""

    date: date | None
    value: float | None
    previous_7d_mean: float | None
    label: str = PROPRIETARY_LABEL
    trend: Trend
    evidence: Evidence


def proprietary_metric(
    series: Mapping[date, float | None], end: date, name: str
) -> ProprietaryMetric:
    days = sorted(d for d, v in series.items() if v is not None and d <= end)
    latest_day = days[-1] if days else None
    value = series[latest_day] if latest_day else None
    previous = (
        mean(
            _window(
                series, latest_day - timedelta(days=RECENT_DAYS), latest_day - timedelta(days=1)
            )
        )
        if latest_day
        else None
    )
    delta = value - previous if value is not None and previous is not None else None
    if delta is None:
        trend = Trend(direction="indetermine", window="dernière valeur vs 7 j précédents")
    else:
        direction = "stable" if delta == 0 else ("hausse" if delta > 0 else "baisse")
        trend = Trend(
            direction=direction,
            delta=delta,
            delta_pct=pct_change(value, previous),
            window="dernière valeur vs 7 j précédents",
        )
    return ProprietaryMetric(
        date=latest_day,
        value=value,
        previous_7d_mean=previous,
        trend=trend,
        evidence=Evidence(
            level="avis_montre",
            summary=f"{name} : indicateur propriétaire Garmin, algorithme non publié, "
            "non validé ; affiché tel quel, sans interprétation.",
        ),
    )


def find_key(data: Any, key: str, _depth: int = 0) -> Any:
    """Première valeur numérique de `key` dans une structure JSON imbriquée (recherche prudente)."""
    if _depth > 12:
        return None
    if isinstance(data, dict):
        if isinstance(data.get(key), int | float) and not isinstance(data.get(key), bool):
            return data[key]
        for v in data.values():
            found = find_key(v, key, _depth + 1)
            if found is not None:
                return found
    elif isinstance(data, list):
        for v in data:
            found = find_key(v, key, _depth + 1)
            if found is not None:
                return found
    return None


class GarminAcwr(BaseModel):
    """ACWR : jamais calculé ici ; uniquement la valeur Garmin, en gris, sans alerte."""

    value: float
    date: date
    label: str = "non validé"
    evidence: Evidence


def garmin_acwr(training_status: Any, day: date) -> GarminAcwr | None:
    value = find_key(training_status, "dailyAcuteChronicWorkloadRatio")
    if value is None:
        return None
    return GarminAcwr(
        value=float(value),
        date=day,
        evidence=Evidence(
            level="non_valide",
            summary=(
                "Ratio charge aiguë/chronique fourni par Garmin. Non validé comme indicateur de "
                "risque de blessure : aucune alerte n'en est tirée."
            ),
        ),
    )
