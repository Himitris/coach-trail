"""Allure ajustée à la pente (GAP), allure normalisée (NGP) et vitesse ascensionnelle.

Modèle de coût énergétique de la course en pente de Minetti et al. (2002, J Appl Physiol 93:1039),
coureurs sur tapis, pente i (fraction, +0,10 = 10 %), coût en J/(kg·m) :

    C(i) = 155,4 i⁵ − 30,4 i⁴ − 43,3 i³ + 46,3 i² + 19,5 i + 3,6     (valide pour −0,45 ≤ i ≤ 0,45)

À plat C(0) = 3,6. Une vitesse v sur une pente i demande le même effort qu'une vitesse « à plat »

    v_plat = v × C(i) / C(0)

GAP (allure ajustée) = temps en mouvement ÷ distance équivalente à plat (Σ v_plat × dt).
NGP (allure normalisée) : moyenne glissante de 30 s de v_plat, puis moyenne d'ordre 4
(Σ v⁴ / n)^(1/4), ce qui pondère davantage les passages difficiles (même principe que la puissance
normalisée) ; exprimée en allure.

Limites : modèle moyen, pas individualisé ; le terrain technique, la fatigue et l'altitude ne sont
pas pris en compte ; l'altimétrie de la montre est bruitée (profil lissé avant de calculer la
pente). À lire en comparaison entre séances, pas comme une mesure exacte.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.metrics.climbs import smooth

MINETTI_FLAT = 3.6
MAX_GRADE = 0.45
MIN_MOVING_SPEED_MS = 0.6
MAX_GAP_S = 15.0
ALT_SMOOTH = 15  # échantillons
GRADE_WINDOW_M = 40.0  # la pente est la différence d'altitude sur cette longueur autour du point
NGP_WINDOW_S = 30


def minetti_cost(grade: float) -> float:
    """Coût énergétique J/(kg·m) à la pente `grade` (fraction), bornée à ±45 %."""
    i = max(-MAX_GRADE, min(MAX_GRADE, grade))
    return 155.4 * i**5 - 30.4 * i**4 - 43.3 * i**3 + 46.3 * i**2 + 19.5 * i + MINETTI_FLAT


def flat_equivalent_ratio(grade: float) -> float:
    return minetti_cost(grade) / MINETTI_FLAT


@dataclass(frozen=True)
class PaceSummary:
    moving_time_s: float
    distance_m: float
    flat_distance_m: float
    pace_s_per_km: float | None  # allure réelle en mouvement
    gap_s_per_km: float | None
    ngp_s_per_km: float | None


def _grades(dist: Sequence[float], alt: Sequence[float]) -> list[float]:
    """Pente locale de chaque échantillon : Δaltitude / Δdistance sur ~GRADE_WINDOW_M autour."""
    n = len(dist)
    out = [0.0] * n
    lo = hi = 0
    for i in range(n):
        while lo < i and dist[i] - dist[lo] > GRADE_WINDOW_M / 2:
            lo += 1
        hi = max(hi, i)
        while hi + 1 < n and dist[hi + 1] - dist[i] <= GRADE_WINDOW_M / 2:
            hi += 1
        run = dist[hi] - dist[lo]
        out[i] = (alt[hi] - alt[lo]) / run if run >= GRADE_WINDOW_M / 4 else 0.0
    return out


def pace_summary(
    t: Sequence[float | None],
    distance_m: Sequence[float | None],
    altitude_m: Sequence[float | None],
) -> PaceSummary | None:
    """GAP et NGP d'une sortie. None si le temps, la distance ou l'altitude manquent."""
    rows = [
        (float(ti), float(d), float(a))
        for ti, d, a in zip(t, distance_m, altitude_m, strict=False)
        if ti is not None and d is not None and a is not None
    ]
    if len(rows) < 3:
        return None
    ts = [r[0] for r in rows]
    dist = [r[1] for r in rows]
    alt = smooth([r[2] for r in rows], ALT_SMOOTH)
    grades = _grades(dist, alt)

    moving = distance = flat = 0.0
    equivalent: list[tuple[float, float]] = []  # (t, v_plat) des échantillons en mouvement
    for i in range(1, len(rows)):
        dt = ts[i] - ts[i - 1]
        dd = dist[i] - dist[i - 1]
        if dt <= 0 or dt > MAX_GAP_S or dd < 0:
            continue
        v = dd / dt
        if v < MIN_MOVING_SPEED_MS:
            continue
        ratio = flat_equivalent_ratio((grades[i] + grades[i - 1]) / 2)
        moving += dt
        distance += dd
        flat += dd * ratio
        equivalent.append((ts[i], v * ratio))
    if moving <= 0 or flat <= 0:
        return None
    return PaceSummary(
        moving_time_s=moving,
        distance_m=distance,
        flat_distance_m=flat,
        pace_s_per_km=moving / distance * 1000,
        gap_s_per_km=moving / flat * 1000,
        ngp_s_per_km=_ngp(equivalent),
    )


def _ngp(samples: Sequence[tuple[float, float]]) -> float | None:
    """Moyenne glissante 30 s des vitesses équivalentes, puis moyenne d'ordre 4, en s/km."""
    if len(samples) < NGP_WINDOW_S:
        return None
    rolled: list[float] = []
    lo = 0
    total = 0.0
    for hi, (t_hi, v) in enumerate(samples):
        total += v
        while t_hi - samples[lo][0] >= NGP_WINDOW_S:
            total -= samples[lo][1]
            lo += 1
        if t_hi - samples[0][0] >= NGP_WINDOW_S - 1:
            rolled.append(total / (hi - lo + 1))
    if not rolled:
        return None
    mean4 = (sum(v**4 for v in rolled) / len(rolled)) ** 0.25
    return 1000 / mean4 if mean4 > 0 else None


def ascent_speed_m_per_h(gain_m: float, duration_s: float | None) -> float | None:
    """Vitesse ascensionnelle (VAM) : mètres de D+ par heure de montée."""
    if duration_s is None or duration_s <= 0:
        return None
    return gain_m / duration_s * 3600
