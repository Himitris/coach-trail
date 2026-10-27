"""Objectif de course : compte à rebours, volume récent face au profil, prédictions, TSB projeté.

- jours restants jusqu'à la date de la course ;
- 4 dernières semaines (28 jours avant aujourd'hui) : distance et D+ totaux, moyenne hebdomadaire,
  plus longue sortie, comparés à la distance et au D+ de la course (pourcentages, sans verdict) ;
- prédictions Garmin (5 km, 10 km, semi, marathon) : estimations de la montre, non validées ;
- TSB projeté à la date de course : prolongation des moyennes exponentielles CTL/ATL (42 j / 7 j)
  avec deux scénarios simples, « repos complet » (charge 0) et « charge maintenue » (moyenne
  quotidienne des 28 derniers jours). Courbe de tendance, pas une prévision de forme.
"""

import math
from collections.abc import Sequence
from datetime import date, timedelta

from pydantic import BaseModel

from app.metrics.fitness import ATL_DAYS, CTL_DAYS, FitnessPoint
from app.metrics.models import Evidence
from app.metrics.volume import ActivityRow

WINDOW_DAYS = 28
MAX_HORIZON_DAYS = 400
PREDICTION_KEYS = (
    ("time5K", "5 km"),
    ("time10K", "10 km"),
    ("timeHalfMarathon", "Semi-marathon"),
    ("timeMarathon", "Marathon"),
)


class RecentVolume(BaseModel):
    window_days: int
    distance_km: float
    dplus_m: float
    avg_weekly_km: float
    avg_weekly_dplus_m: float
    longest_km: float | None
    longest_dplus_m: float | None
    avg_weekly_km_vs_race_pct: float | None
    avg_weekly_dplus_vs_race_pct: float | None
    longest_km_vs_race_pct: float | None
    longest_dplus_vs_race_pct: float | None
    evidence: Evidence


class RacePrediction(BaseModel):
    label: str
    seconds: float
    note: str = "estimation de la montre, non validée"


class TsbScenario(BaseModel):
    name: str
    daily_load: float
    ctl: float
    atl: float
    tsb: float


class TsbProjection(BaseModel):
    from_date: date
    race_date: date
    days: int
    scenarios: list[TsbScenario]
    evidence: Evidence


class RaceGoalReport(BaseModel):
    goal_id: int
    nom: str
    date: date
    distance_km: float | None
    dplus_m: int | None
    days_left: int
    profile: list[list[float]] | None
    profile_dplus_m: float | None
    recent: RecentVolume
    predictions: list[RacePrediction]
    projection: TsbProjection | None


def _pct(value: float | None, ref: float | None) -> float | None:
    if value is None or not ref:
        return None
    return value / ref * 100


def recent_volume(
    rows: Sequence[ActivityRow], today: date, race_km: float | None, race_dplus: float | None
) -> RecentVolume:
    start = today - timedelta(days=WINDOW_DAYS - 1)
    window = [r for r in rows if start <= r.day <= today]
    km = sum((r.distance_m or 0.0) for r in window) / 1000
    dplus = sum((r.gain_m or 0.0) for r in window)
    weeks = WINDOW_DAYS / 7
    longest = max(window, key=lambda r: r.distance_m or 0.0, default=None)
    longest_km = (longest.distance_m or 0.0) / 1000 if longest and longest.distance_m else None
    longest_dplus = longest.gain_m if longest and longest.distance_m else None
    return RecentVolume(
        window_days=WINDOW_DAYS,
        distance_km=km,
        dplus_m=dplus,
        avg_weekly_km=km / weeks,
        avg_weekly_dplus_m=dplus / weeks,
        longest_km=longest_km,
        longest_dplus_m=longest_dplus,
        avg_weekly_km_vs_race_pct=_pct(km / weeks, race_km),
        avg_weekly_dplus_vs_race_pct=_pct(dplus / weeks, race_dplus),
        longest_km_vs_race_pct=_pct(longest_km, race_km),
        longest_dplus_vs_race_pct=_pct(longest_dplus, race_dplus),
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Volume des 4 dernières semaines (montre) comparé à la distance et au D+ de la "
                "course : un repère de préparation, pas un verdict. Le D+ est moins précis que "
                "la distance (altimètre)."
            ),
        ),
    )


def project(last: FitnessPoint, daily_load: float, days: int) -> tuple[float, float, float]:
    """(CTL, ATL, TSB) après `days` jours à charge quotidienne constante, depuis `last`."""
    k_ctl = 1 - math.exp(-1 / CTL_DAYS)
    k_atl = 1 - math.exp(-1 / ATL_DAYS)
    ctl, atl = last.ctl, last.atl
    for _ in range(days):
        ctl += (daily_load - ctl) * k_ctl
        atl += (daily_load - atl) * k_atl
    return ctl, atl, ctl - atl


def tsb_projection(
    last: FitnessPoint | None, recent_daily_load: float, race_date: date
) -> TsbProjection | None:
    if last is None or race_date <= last.date:
        return None
    days = (race_date - last.date).days
    if days > MAX_HORIZON_DAYS:
        return None
    scenarios: list[TsbScenario] = []
    for name, load in (
        ("Repos complet jusqu'à la course", 0.0),
        ("Charge récente maintenue", recent_daily_load),
    ):
        ctl, atl, tsb = project(last, load, days)
        scenarios.append(TsbScenario(name=name, daily_load=load, ctl=ctl, atl=atl, tsb=tsb))
    return TsbProjection(
        from_date=last.date,
        race_date=race_date,
        days=days,
        scenarios=scenarios,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Prolongation des courbes CTL/ATL (42 j / 7 j) sous deux scénarios extrêmes : "
                "courbe de tendance, pas une prévision de forme ni un verdict de préparation."
            ),
        ),
    )


def predictions(values: dict[str, float | None]) -> list[RacePrediction]:
    out: list[RacePrediction] = []
    for key, label in PREDICTION_KEYS:
        seconds = values.get(key)
        if seconds is not None:
            out.append(RacePrediction(label=label, seconds=float(seconds)))
    return out
