"""Renforcement : séances par semaine face à un objectif fixé par l'utilisateur.

Séance détectée = activité d'un sport de renforcement (musculation, fitness, HIIT, pilates, yoga,
cardio indoor). Séance saisie = ajoutée à la main quand la montre n'a rien enregistré. Pour ne pas
compter deux fois la même séance, un jour compte max(détectées, saisies). Compteur simple : le
chiffre n'est pas interprété ; l'objectif est celui de l'athlète.
"""

from collections import Counter
from collections.abc import Iterable
from datetime import date, timedelta

from pydantic import BaseModel

from app.metrics.models import Evidence, monday


class StrengthWeek(BaseModel):
    week_start: date
    complete: bool
    detected: int
    manual: int
    count: int
    target: int | None
    target_met: bool | None


class StrengthReport(BaseModel):
    target: int | None
    weeks: list[StrengthWeek]
    evidence: Evidence


def strength_report(
    detected_days: Iterable[date],
    manual_days: Iterable[date],
    target: int | None,
    today: date,
    weeks: int,
) -> StrengthReport:
    det, man = Counter(detected_days), Counter(manual_days)
    last = monday(today)
    out: list[StrengthWeek] = []
    for k in range(weeks - 1, -1, -1):
        start = last - timedelta(days=7 * k)
        days = [start + timedelta(days=d) for d in range(7)]
        n_det = sum(det[d] for d in days)
        n_man = sum(man[d] for d in days)
        count = sum(max(det[d], man[d]) for d in days)
        out.append(
            StrengthWeek(
                week_start=start,
                complete=start + timedelta(days=6) < today,
                detected=n_det,
                manual=n_man,
                count=count,
                target=target,
                target_met=None if target is None else count >= target,
            )
        )
    return StrengthReport(
        target=target,
        weeks=out,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Compteur simple de séances de renforcement par semaine. Une méta-analyse "
                "(source secondaire) associe le renforcement à moins de blessures de surcharge ; "
                "l'objectif est le vôtre, l'appli ne le juge pas."
            ),
        ),
    )
