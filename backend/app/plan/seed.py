"""Semaine type de développement (`python -m app.cli seed-demo`) : 80/20, 6 jours de course.

Descriptions uniquement : rien n'est envoyé à la montre.
"""

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.metrics.models import monday
from app.models import PlannedSession

# (jour de semaine 0=lundi, titre, type, objectif, durée min, zone cible, D+ cible, consignes)
TYPICAL_WEEK: list[dict[str, Any]] = [
    {
        "d": 0,
        "titre": "Repos",
        "type": "repos",
        "objectif": "Récupération",
        "consignes": "Mobilité douce possible, pas de course.",
    },
    {
        "d": 1,
        "titre": "Footing facile",
        "type": "footing",
        "objectif": "Endurance de base",
        "duree_min": 60,
        "zone_cible": "1-2",
        "dplus_cible": 100,
        "consignes": "Allure conversationnelle, FC en zones 1–2.",
    },
    {
        "d": 2,
        "titre": "Seuil 3 × 8 min",
        "type": "seuil",
        "objectif": "Travail au seuil",
        "duree_min": 70,
        "zone_cible": "4",
        "dplus_cible": 150,
        "consignes": "15 min d'échauffement zones 1–2, 3 × 8 min en zone 4 (récup 3 min), "
        "retour au calme 15 min.",
    },
    {
        "d": 3,
        "titre": "Footing facile",
        "type": "footing",
        "objectif": "Endurance de base",
        "duree_min": 50,
        "zone_cible": "1-2",
        "dplus_cible": 80,
    },
    {
        "d": 4,
        "titre": "Footing récupération",
        "type": "footing",
        "objectif": "Récupération active",
        "duree_min": 45,
        "zone_cible": "1",
        "consignes": "Très facile, terrain plat.",
    },
    {
        "d": 4,
        "titre": "Renforcement",
        "type": "renfo",
        "objectif": "Gainage et force",
        "duree_min": 30,
        "consignes": "Gainage, squats, fentes, mollets.",
    },
    {
        "d": 5,
        "titre": "Côtes",
        "type": "cotes",
        "objectif": "Puissance en montée",
        "duree_min": 60,
        "zone_cible": "1-2",
        "dplus_cible": 400,
        "consignes": "Échauffement 20 min, 8 × 1 min en côte soutenue, récupération en descente.",
    },
    {
        "d": 6,
        "titre": "Sortie longue",
        "type": "longue",
        "objectif": "Endurance spécifique trail",
        "duree_min": 150,
        "zone_cible": "1-2",
        "dplus_cible": 800,
        "consignes": "Terrain proche de la course, ravitaillement à tester.",
    },
]


def seed_demo_week(session: Session, week_of: date, *, force: bool = False) -> int:
    """Ajoute la semaine type ; ne fait rien si la semaine a déjà des séances (sauf `force`)."""
    start = monday(week_of)
    end = start + timedelta(days=6)
    existing = (
        session.scalar(
            select(func.count())
            .select_from(PlannedSession)
            .where(PlannedSession.date >= start, PlannedSession.date <= end)
        )
        or 0
    )
    if existing and not force:
        return 0
    for item in TYPICAL_WEEK:
        session.add(
            PlannedSession(
                date=start + timedelta(days=item["d"]),
                titre=item["titre"],
                type=item["type"],
                objectif=item.get("objectif"),
                duree_min=item.get("duree_min"),
                zone_cible=item.get("zone_cible"),
                dplus_cible=item.get("dplus_cible"),
                consignes=item.get("consignes"),
            )
        )
    session.commit()
    return len(TYPICAL_WEEK)
