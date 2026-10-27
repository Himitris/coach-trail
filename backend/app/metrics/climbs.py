"""Découpage d'une sortie en côtes d'après le profil altimétrique.

Méthode (en zigzag avec hystérésis) : l'altitude est lissée (moyenne glissante), puis on suit les
sommets et les creux successifs ; un changement de sens n'est retenu que s'il dépasse
`hysteresis_m`, ce qui ignore le bruit du capteur et les petits replats. Une montée « creux →
sommet » est une côte si son dénivelé net atteint `min_gain_m` et sa pente moyenne `min_grade_pct`.
Les valeurs sont celles du profil lissé : à lire comme un ordre de grandeur, pas comme une mesure
topographique.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel

DEFAULT_HYSTERESIS_M = 20.0
DEFAULT_MIN_GAIN_M = 50.0
DEFAULT_MIN_GRADE_PCT = 3.0
DEFAULT_SMOOTH = 15  # échantillons (≈ 15 s à 1 Hz)
DEFAULT_FLAT_TOL_M = 2.0  # le pied et le sommet d'une côte excluent les replats de cette hauteur


class Climb(BaseModel):
    start_km: float
    end_km: float
    length_m: float
    gain_m: float
    avg_grade_pct: float
    duration_s: float | None
    avg_hr: float | None


@dataclass(frozen=True)
class _Pivot:
    index: int
    altitude: float


def smooth(values: Sequence[float], window: int) -> list[float]:
    """Moyenne glissante centrée (fenêtre impaire, bords tronqués)."""
    n = len(values)
    if window <= 1 or n == 0:
        return list(values)
    half = window // 2
    prefix = [0.0]
    for v in values:
        prefix.append(prefix[-1] + v)
    out = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        out.append((prefix[hi] - prefix[lo]) / (hi - lo))
    return out


def _pivots(alt: Sequence[float], hysteresis: float) -> list[_Pivot]:
    """Sommets et creux alternés, séparés d'au moins `hysteresis` mètres."""
    if not alt:
        return []
    pivots: list[_Pivot] = []
    high = low = 0  # indices du maximum / minimum depuis le début (phase initiale)
    direction = 0  # 0 inconnu, +1 on monte, -1 on descend
    ext = 0  # extremum courant dans le sens de marche
    for i in range(1, len(alt)):
        if direction == 0:
            if alt[i] > alt[high]:
                high = i
            if alt[i] < alt[low]:
                low = i
            if alt[high] - alt[low] >= hysteresis:
                if low < high:  # première amplitude franche : une montée depuis le creux
                    pivots.append(_Pivot(low, alt[low]))
                    direction, ext = 1, high
                else:
                    pivots.append(_Pivot(high, alt[high]))
                    direction, ext = -1, low
        elif direction == 1:
            if alt[i] > alt[ext]:
                ext = i
            elif alt[ext] - alt[i] >= hysteresis:
                pivots.append(_Pivot(ext, alt[ext]))
                direction, ext = -1, i
        else:
            if alt[i] < alt[ext]:
                ext = i
            elif alt[i] - alt[ext] >= hysteresis:
                pivots.append(_Pivot(ext, alt[ext]))
                direction, ext = 1, i
    if direction != 0:
        pivots.append(_Pivot(ext, alt[ext]))
    return pivots


def detect_climbs(
    distance_m: Sequence[float | None],
    altitude_m: Sequence[float | None],
    time_s: Sequence[float | None] | None = None,
    hr: Sequence[float | None] | None = None,
    *,
    hysteresis_m: float = DEFAULT_HYSTERESIS_M,
    min_gain_m: float = DEFAULT_MIN_GAIN_M,
    min_grade_pct: float = DEFAULT_MIN_GRADE_PCT,
    smooth_window: int = DEFAULT_SMOOTH,
    flat_tol_m: float = DEFAULT_FLAT_TOL_M,
) -> list[Climb]:
    """Côtes d'une sortie ; liste vide si la distance ou l'altitude manquent."""
    rows = [
        (i, d, a)
        for i, (d, a) in enumerate(zip(distance_m, altitude_m, strict=False))
        if d is not None and a is not None
    ]
    if len(rows) < 2:
        return []
    idx = [r[0] for r in rows]
    dist = [r[1] for r in rows]
    alt = smooth([r[2] for r in rows], smooth_window)

    pivots = _pivots(alt, hysteresis_m)
    climbs: list[Climb] = []
    for low, high in zip(pivots, pivots[1:], strict=False):
        if high.altitude <= low.altitude:
            continue  # descente
        if high.altitude - low.altitude < min_gain_m:
            continue
        # le pied et le sommet se resserrent sur la vraie montée (sans le plat qui y mène)
        start, end = low.index, high.index
        while start < end and alt[start + 1] <= low.altitude + flat_tol_m:
            start += 1
        while end > start and alt[end - 1] >= high.altitude - flat_tol_m:
            end -= 1
        gain = alt[end] - alt[start]
        length = dist[end] - dist[start]
        if length <= 0:
            continue
        grade = gain / length * 100
        if grade < min_grade_pct:
            continue
        first, last = idx[start], idx[end]
        duration: float | None = None
        if time_s is not None and time_s[first] is not None and time_s[last] is not None:
            duration = float(time_s[last] or 0) - float(time_s[first] or 0)
        hrs = [h for h in (hr or [])[first : last + 1] if h]
        climbs.append(
            Climb(
                start_km=dist[start] / 1000,
                end_km=dist[end] / 1000,
                length_m=length,
                gain_m=gain,
                avg_grade_pct=grade,
                duration_s=duration,
                avg_hr=sum(hrs) / len(hrs) if hrs else None,
            )
        )
    return climbs
