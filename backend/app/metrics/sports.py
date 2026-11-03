"""Familles de sports : la course alimente les métriques de charge, le reste est compté à part.

Vélo, randonnée et autres activités ne sont pas mélangés aux volumes de course (km, D+, temps,
séances, intensité, forme) : ils sont affichés séparément et peuvent être planifiés.
"""

from collections.abc import Iterable, Sequence

from app.metrics.volume import ActivityRow

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
HIKE_SPORTS = frozenset({"hiking", "walking", "mountaineering"})
STRENGTH_SPORTS = frozenset(
    {"strength_training", "fitness_equipment", "hiit", "indoor_cardio", "pilates", "yoga"}
)

FAMILY_LABELS = {"velo": "Vélo", "rando": "Randonnée / marche", "autre": "Autres activités"}


def is_bike(sport: str) -> bool:
    s = sport.lower()
    return "cycl" in s or "bik" in s or "ride" in s


def family(sport: str, is_race: bool = False) -> str:
    """« course », « velo », « rando », « renfo » ou « autre »."""
    if sport in RUN_SPORTS or is_race:
        return "course"
    if is_bike(sport):
        return "velo"
    if sport in HIKE_SPORTS:
        return "rando"
    if sport in STRENGTH_SPORTS:
        return "renfo"
    return "autre"


def foot_only(rows: Iterable[ActivityRow]) -> list[ActivityRow]:
    """Séances de course à pied (et courses) : base des volumes et de la charge."""
    return [r for r in rows if family(r.sport, r.is_race) == "course"]


def other_by_family(rows: Sequence[ActivityRow]) -> dict[str, list[ActivityRow]]:
    """Vélo, randonnée et autres activités (hors course et renforcement), par famille."""
    out: dict[str, list[ActivityRow]] = {}
    for r in rows:
        fam = family(r.sport, r.is_race)
        if fam not in ("course", "renfo"):
            out.setdefault(fam, []).append(r)
    return out
