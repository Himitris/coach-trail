"""Fatigue musculaire : dénivelé négatif (D−), séances à fort D−, courbatures à 48 h.

La descente produit l'essentiel du dommage musculaire en trail (revue systématique) ; l'effet de
répétition protège ensuite. Repères appliqués (documentés, modifiables) :

- séance à fort D− : D− ≥ 800 m, ou D− ≥ 400 m avec au moins 80 m de D− par km ;
- courbatures à 48 h : la saisie du soir (0–10) du jour J+2 de la séance ;
- suggestion informative : dans les 3 jours qui suivent une séance à fort D−, rappel du repère
  « 2 à 3 jours faciles après une descente intense » (Koop). Rien n'est prescrit.
"""

from collections.abc import Mapping, Sequence
from datetime import date, timedelta

from pydantic import BaseModel

from app.metrics.models import Evidence, monday
from app.metrics.volume import ActivityRow

STRONG_LOSS_M = 800.0
STRONG_LOSS_LOW_M = 400.0
STRONG_LOSS_PER_KM = 80.0
SORENESS_DELAY_DAYS = 2
EASY_DAYS = 3


class WeekDescent(BaseModel):
    week_start: date
    complete: bool
    loss_m: float
    sessions: int
    strong_sessions: int


class StrongDescent(BaseModel):
    activity_id: int
    day: date
    loss_m: float
    loss_per_km: float | None
    soreness_date: date  # jour de la saisie à 48 h
    soreness: int | None  # None : pas de saisie ce jour-là


class EasyDaysHint(BaseModel):
    after: date
    easy_from: date
    easy_until: date
    message: str


class FatigueReport(BaseModel):
    weeks: list[WeekDescent]
    strong_sessions: list[StrongDescent]
    suggestion: EasyDaysHint | None
    evidence: Evidence


def is_strong_descent(loss_m: float | None, distance_m: float | None) -> bool:
    if not loss_m:
        return False
    if loss_m >= STRONG_LOSS_M:
        return True
    return bool(
        loss_m >= STRONG_LOSS_LOW_M
        and distance_m
        and loss_m / (distance_m / 1000) >= STRONG_LOSS_PER_KM
    )


def fatigue_report(
    rows: Sequence[ActivityRow], soreness: Mapping[date, int], today: date, weeks: int
) -> FatigueReport:
    last = monday(today)
    first = last - timedelta(days=7 * (weeks - 1))
    per_week: dict[date, list[ActivityRow]] = {
        first + timedelta(days=7 * k): [] for k in range(weeks)
    }
    strong: list[StrongDescent] = []
    for r in rows:
        if r.day < first or r.day > today:
            continue
        per_week[monday(r.day)].append(r)
        if is_strong_descent(r.loss_m, r.distance_m):
            due = r.day + timedelta(days=SORENESS_DELAY_DAYS)
            km = (r.distance_m or 0) / 1000
            strong.append(
                StrongDescent(
                    activity_id=r.id,
                    day=r.day,
                    loss_m=r.loss_m or 0.0,
                    loss_per_km=(r.loss_m or 0) / km if km else None,
                    soreness_date=due,
                    soreness=soreness.get(due) if due <= today else None,
                )
            )
    out = [
        WeekDescent(
            week_start=start,
            complete=start + timedelta(days=6) < today,
            loss_m=sum(r.loss_m or 0.0 for r in items),
            sessions=len(items),
            strong_sessions=sum(is_strong_descent(r.loss_m, r.distance_m) for r in items),
        )
        for start, items in per_week.items()
    ]
    strong.sort(key=lambda s: (s.day, s.activity_id))
    hint: EasyDaysHint | None = None
    recent = [s for s in strong if 0 <= (today - s.day).days < EASY_DAYS]
    if recent:
        s = recent[-1]
        hint = EasyDaysHint(
            after=s.day,
            easy_from=s.day + timedelta(days=1),
            easy_until=s.day + timedelta(days=EASY_DAYS),
            message=(
                f"Grosse descente le {s.day.isoformat()} ({s.loss_m:.0f} m de D−) : le repère "
                "courant est de 2 à 3 jours faciles ensuite. Information, pas une prescription."
            ),
        )
    return FatigueReport(
        weeks=out,
        strong_sessions=strong,
        suggestion=hint,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "La descente produit l'essentiel du dommage musculaire en trail (revue "
                "systématique) et l'effet de répétition protège. Seuils de D− et délai de 48 h : "
                "repères pratiques, pas des mesures de fatigue."
            ),
        ),
    )
