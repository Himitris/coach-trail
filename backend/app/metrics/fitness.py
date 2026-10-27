"""Charge d'entraînement, CTL / ATL / TSB.

Charge d'une séance (points, « équivalent TSS par FC ») :

    y      = (FC - FC_repos) / (FC_max - FC_repos)           réserve de FC, bornée à [0 ; 1,1]
    y_seuil = (FC_seuil - FC_repos) / (FC_max - FC_repos)
    charge = Σ  dt_h × (y / y_seuil)² × 100                   sur les échantillons du flux

Une heure à la FC de seuil vaut donc 100 points. Sans flux, la charge est estimée avec la FC
moyenne (sous-estime les séances variables). Approximation de la convention TSS, pas une mesure
validée : à lire en tendance. Aucun coefficient dépendant du sexe n'est supposé.

Moyennes exponentielles (constantes de temps 42 j et 7 j), chaque jour à partir de 0 :

    CTL_j = CTL_{j-1} + (charge_j - CTL_{j-1}) × (1 - e^{-1/42})
    ATL_j = ATL_{j-1} + (charge_j - ATL_{j-1}) × (1 - e^{-1/7})
    TSB_j = CTL_j - ATL_j                                     valeurs de fin de journée

La série est recalculée depuis le premier jour de données à chaque appel (rien n'est stocké).
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from pydantic import BaseModel

from app.metrics.models import Evidence, Trend, trend_from_delta

CTL_DAYS = 42
ATL_DAYS = 7
RAMP_DAYS = 28
Y_MAX = 1.1
MAX_GAP_S = 15.0
LAST_SAMPLE_S = 1.0
THRESHOLD_FALLBACK_PCT = 88  # seuil estimé en % de FC max quand le profil n'en a pas
REST_FALLBACK_BPM = 55
STALE_PROFILE_DAYS = 90


@dataclass(frozen=True)
class HrParams:
    fc_max: float
    fc_rest: float
    fc_threshold: float

    @property
    def y_threshold(self) -> float:
        return (self.fc_threshold - self.fc_rest) / (self.fc_max - self.fc_rest)

    def y(self, hr: float) -> float:
        raw = (hr - self.fc_rest) / (self.fc_max - self.fc_rest)
        return min(max(raw, 0.0), Y_MAX)


def hr_params(
    fc_max: int, fc_rest: int | None, fc_threshold: int | None
) -> tuple[HrParams, list[str]]:
    """Paramètres de FC du profil, avec la liste des substitutions faites (à afficher)."""
    notes: list[str] = []
    if fc_rest is None:
        fc_rest = REST_FALLBACK_BPM
        notes.append(f"FC repos absente du profil : {REST_FALLBACK_BPM} bpm utilisée par défaut.")
    if fc_threshold is None:
        fc_threshold = round(fc_max * THRESHOLD_FALLBACK_PCT / 100)
        notes.append(
            f"Seuil lactique absent du profil : estimé à {THRESHOLD_FALLBACK_PCT} % de la FC max "
            f"({fc_threshold} bpm)."
        )
    if not fc_rest < fc_threshold < fc_max:
        fc_threshold = round(fc_rest + 0.85 * (fc_max - fc_rest))
        notes.append(f"Seuil incohérent avec FC repos/max : remplacé par {fc_threshold} bpm.")
    return HrParams(fc_max, fc_rest, fc_threshold), notes


def load_from_stream(
    t: Sequence[float | None], hr: Sequence[float | None], p: HrParams
) -> tuple[float, float]:
    """(charge, secondes avec FC) d'après un flux."""
    n = min(len(t), len(hr))
    load = 0.0
    covered = 0.0
    yt = p.y_threshold
    for i in range(n):
        ti = t[i]
        h = hr[i]
        if ti is None:
            continue
        nxt = t[i + 1] if i + 1 < n else None
        dt = LAST_SAMPLE_S if nxt is None else nxt - ti
        if dt <= 0:
            continue
        dt = min(dt, MAX_GAP_S)
        if h is None or h <= 0:
            continue
        covered += dt
        load += dt / 3600 * (p.y(h) / yt) ** 2 * 100
    return load, covered


def load_from_average(duration_s: float, hr_avg: float, p: HrParams) -> float:
    return duration_s / 3600 * (p.y(hr_avg) / p.y_threshold) ** 2 * 100


class FitnessPoint(BaseModel):
    date: date
    load: float
    ctl: float
    atl: float
    tsb: float


def fitness_series(daily_load: Mapping[date, float], start: date, end: date) -> list[FitnessPoint]:
    """CTL/ATL/TSB de `start` à `end` inclus, en partant de 0 le jour `start`."""
    k_ctl = 1 - math.exp(-1 / CTL_DAYS)
    k_atl = 1 - math.exp(-1 / ATL_DAYS)
    ctl = atl = 0.0
    out: list[FitnessPoint] = []
    day = start
    while day <= end:
        load = daily_load.get(day, 0.0)
        ctl += (load - ctl) * k_ctl
        atl += (load - atl) * k_atl
        out.append(FitnessPoint(date=day, load=load, ctl=ctl, atl=atl, tsb=ctl - atl))
        day += timedelta(days=1)
    return out


class FitnessReport(BaseModel):
    start: date
    end: date
    points: list[FitnessPoint]
    ctl_ramp_4w: float | None
    ctl_ramp_per_week: float | None
    history_days: int
    trend: Trend
    warnings: list[str]
    evidence: Evidence


def fitness_report(
    daily_load: Mapping[date, float],
    first_data_day: date | None,
    start: date,
    end: date,
    notes: Sequence[str] = (),
) -> FitnessReport:
    """Série sur [start, end], calculée depuis le premier jour de données (échauffement inclus)."""
    warnings = list(notes)
    if first_data_day is None or first_data_day > end:
        return FitnessReport(
            start=start,
            end=end,
            points=[],
            ctl_ramp_4w=None,
            ctl_ramp_per_week=None,
            history_days=0,
            trend=Trend(direction="indetermine", window="CTL sur 4 semaines"),
            warnings=[*warnings, "Aucune séance avec données de FC sur la période."],
            evidence=_evidence(),
        )
    origin = min(first_data_day, start)
    full = fitness_series(daily_load, origin, end)
    by_day = {p.date: p for p in full}
    history_days = (end - first_data_day).days + 1
    if (start - first_data_day).days < CTL_DAYS:
        warnings.append(
            f"Moins de {CTL_DAYS} jours d'historique avant le début de la période : "
            "le CTL est sous-estimé (montée en charge incomplète)."
        )
    end_point = by_day[end]
    back = by_day.get(end - timedelta(days=RAMP_DAYS))
    ramp = end_point.ctl - back.ctl if back else None
    if back is None:
        warnings.append("Historique inférieur à 4 semaines : rampe de CTL non calculable.")
    return FitnessReport(
        start=start,
        end=end,
        points=[p for p in full if p.date >= start],
        ctl_ramp_4w=ramp,
        ctl_ramp_per_week=ramp / 4 if ramp is not None else None,
        history_days=history_days,
        trend=trend_from_delta(ramp, None, "CTL sur 4 semaines", band=1.0, use_pct=False),
        warnings=warnings,
        evidence=_evidence(),
    )


def _evidence() -> Evidence:
    return Evidence(
        level="indicatif",
        summary=(
            "Courbes de tendance (constantes 42 j / 7 j) calculées depuis la FC des séances ; "
            "approximation du modèle charge/fatigue, pas un verdict ni un prédicteur de blessure."
        ),
    )
