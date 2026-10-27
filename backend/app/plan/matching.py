"""Rapprochement prévu / réalisé pour un jour donné (jour local).

Règle (documentée et testée) :

1. Les séances réalisées d'un jour sont les activités dédupliquées (source la plus prioritaire de
   chaque groupe) dont la date locale est ce jour. Aucune fenêtre horaire : minuit local sépare
   deux jours.
2. Une séance prévue ne peut être rapprochée que d'une activité de sport compatible :
   footing / côtes / seuil / longue / fractionné / course ↔ course à pied (route, trail, tapis,
   piste) ; renfo ↔ renforcement, fitness, HIIT, cardio indoor, pilates, yoga ; autre ↔ tout sport.
   Une activité marquée « course » (is_race) est compatible avec tous les types de course à pied.
3. Plusieurs séances prévues le même jour sont traitées de la plus longue à la plus courte (durée
   prévue absente = dernière) ; chacune prend, parmi les activités compatibles encore libres,
   celle dont la durée est la plus proche de la durée prévue (sans durée prévue : la plus longue).
   Une activité n'est rapprochée qu'une fois.
4. Statut d'une séance prévue :
   - rapprochée : « partiel » si durée réalisée < 80 % de la durée prévue, sinon « fait » ;
   - non rapprochée : « manqué » si le jour est passé, « à venir » aujourd'hui et plus tard ;
   - « repos » prévu : « imprévu » si une activité a lieu ce jour-là, « fait » (repos respecté) si
     le jour est passé sans activité, « à venir » sinon.
5. Les activités qui ne sont rapprochées d'aucune séance sont « imprévues » (jour sans plan, jour de
   repos, sport incompatible, séance en plus). Statut du jour : celui des séances prévues si elles
   ont toutes le même (« fait », « manqué », « à venir »…), « partiel » sinon ; « imprévu » s'il n'y
   a que des activités sans plan ; aucun statut s'il ne se passe rien.
6. Les écarts (durée en minutes, D+ en mètres) = réalisé − prévu, absents si l'une des valeurs
   manque. Aucune évaluation de l'intensité : elle relève des métriques.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date

from app.metrics.volume import ActivityRow

FAIT = "fait"
MANQUE = "manqué"
PARTIEL = "partiel"
A_VENIR = "à venir"
IMPREVU = "imprévu"

DONE_RATIO = 0.8

RUN_SPORTS = frozenset(
    {
        "running",
        "trail_running",
        "treadmill_running",
        "track_running",
        "virtual_run",
        "ultra_run",
        "obstacle_run",
    }
)
STRENGTH_SPORTS = frozenset(
    {"strength_training", "fitness_equipment", "hiit", "indoor_cardio", "pilates", "yoga"}
)
RUN_TYPES = frozenset({"footing", "cotes", "seuil", "longue", "fractionne", "course"})
SESSION_TYPES = RUN_TYPES | {"renfo", "repos", "autre"}


def compatible(session_type: str, activity: ActivityRow) -> bool:
    if session_type == "repos":
        return False
    if session_type == "autre":
        return True
    if session_type in RUN_TYPES:
        return activity.sport in RUN_SPORTS or activity.is_race
    if session_type == "renfo":
        return activity.sport in STRENGTH_SPORTS
    return False


@dataclass(frozen=True)
class PlannedRow:
    id: int
    type: str
    duree_min: int | None = None
    dplus_cible: int | None = None


@dataclass(frozen=True)
class SessionResult:
    planned_id: int
    status: str
    activity: ActivityRow | None = None
    duration_delta_min: float | None = None
    duration_ratio: float | None = None
    dplus_delta_m: float | None = None


@dataclass
class DayMatch:
    day: date
    results: list[SessionResult] = field(default_factory=list)
    unplanned: list[ActivityRow] = field(default_factory=list)
    status: str | None = None


def _matched_result(p: PlannedRow, a: ActivityRow) -> SessionResult:
    minutes = a.duration_s / 60
    ratio = minutes / p.duree_min if p.duree_min else None
    return SessionResult(
        planned_id=p.id,
        status=PARTIEL if ratio is not None and ratio < DONE_RATIO else FAIT,
        activity=a,
        duration_delta_min=minutes - p.duree_min if p.duree_min else None,
        duration_ratio=ratio,
        dplus_delta_m=(
            a.gain_m - p.dplus_cible if a.gain_m is not None and p.dplus_cible is not None else None
        ),
    )


def match_day(
    day: date, planned: Sequence[PlannedRow], activities: Sequence[ActivityRow], today: date
) -> DayMatch:
    remaining = sorted(activities, key=lambda a: (a.start_utc, a.id))
    results: dict[int, SessionResult] = {}

    runnable = [p for p in planned if p.type != "repos"]
    for p in sorted(runnable, key=lambda p: (-(p.duree_min or 0), p.id)):
        options = [a for a in remaining if compatible(p.type, a)]
        if not options:
            results[p.id] = SessionResult(p.id, MANQUE if day < today else A_VENIR)
            continue
        target = p.duree_min
        if target:
            best = min(options, key=lambda a: (abs(a.duration_s / 60 - target), a.start_utc, a.id))
        else:
            best = max(options, key=lambda a: (a.duration_s, -a.id))
        remaining.remove(best)
        results[p.id] = _matched_result(p, best)

    for p in planned:
        if p.type == "repos":
            if remaining:
                status = IMPREVU
            elif day < today:
                status = FAIT
            else:
                status = A_VENIR
            results[p.id] = SessionResult(p.id, status)

    ordered = [results[p.id] for p in planned]
    return DayMatch(day, ordered, remaining, _day_status(planned, ordered, remaining))


def _day_status(
    planned: Sequence[PlannedRow],
    results: Sequence[SessionResult],
    leftovers: Sequence[ActivityRow],
) -> str | None:
    if not planned:
        return IMPREVU if leftovers else None
    real = [r.status for p, r in zip(planned, results, strict=True) if p.type != "repos"]
    if not real:
        return results[0].status  # jour de repos
    return real[0] if len(set(real)) == 1 else PARTIEL
