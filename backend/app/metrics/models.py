"""Types communs des métriques : valeur + tendance + niveau de preuve.

Règle projet : jamais de score unique maison ; chaque composante est exposée avec sa tendance et
un `evidence` (niveau de preuve + une phrase) réutilisé par l'UI et l'export.
"""

from collections.abc import Iterable
from datetime import date
from typing import Literal

from pydantic import BaseModel

# etabli : mesure directe ou méthode standard ; indicatif : méthode approchée, utile en tendance ;
# non_valide : calcul sans validation scientifique (affiché en gris) ;
# avis_montre : indicateur propriétaire du fabricant, repris tel quel.
EvidenceLevel = Literal["etabli", "indicatif", "non_valide", "avis_montre"]
Direction = Literal["hausse", "baisse", "stable", "indetermine"]


class Evidence(BaseModel):
    level: EvidenceLevel
    summary: str


class Trend(BaseModel):
    direction: Direction
    delta: float | None = None
    delta_pct: float | None = None
    window: str


def pct_change(new: float | None, old: float | None) -> float | None:
    """Variation en % de `old` vers `new` ; None si indéfinie (valeur absente ou base nulle)."""
    if new is None or old is None or old == 0:
        return None
    return (new - old) / abs(old) * 100


def mean(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def trend_from_delta(
    delta: float | None, delta_pct: float | None, window: str, *, band: float, use_pct: bool = True
) -> Trend:
    """Direction d'après le signe de l'écart ; « stable » si l'écart reste dans ±band."""
    measure = delta_pct if use_pct else delta
    if measure is None:
        return Trend(direction="indetermine", delta=delta, delta_pct=delta_pct, window=window)
    if abs(measure) < band:
        direction: Direction = "stable"
    else:
        direction = "hausse" if measure > 0 else "baisse"
    return Trend(direction=direction, delta=delta, delta_pct=delta_pct, window=window)


def monday(d: date) -> date:
    from datetime import timedelta

    return d - timedelta(days=d.weekday())
