"""Préparation des flux pour l'affichage : réduction du nombre de points, allure."""

from collections.abc import Mapping, Sequence

MIN_MOVING_SPEED_MS = 0.6  # en dessous : à l'arrêt, pas d'allure


def pace_from_speed(speed_ms: float | None) -> float | None:
    """Allure en secondes par kilomètre ; None à l'arrêt ou sans vitesse."""
    if speed_ms is None or speed_ms < MIN_MOVING_SPEED_MS:
        return None
    return 1000.0 / speed_ms


def downsample(
    columns: Mapping[str, Sequence[float | None]],
    max_points: int,
    *,
    last: frozenset[str] = frozenset({"distance"}),
    first: frozenset[str] = frozenset({"t"}),
) -> dict[str, list[float | None]]:
    """Regroupe les échantillons par paquets : moyenne des valeurs présentes (lisse le bruit),
    sauf `last` (dernière valeur, ex. distance cumulée) et `first` (première, ex. temps)."""
    n = max((len(v) for v in columns.values()), default=0)
    if n == 0:
        return {k: [] for k in columns}
    size = max(1, -(-n // max_points))  # division par excès
    out: dict[str, list[float | None]] = {k: [] for k in columns}
    for start in range(0, n, size):
        for key, values in columns.items():
            chunk = [v for v in values[start : start + size] if v is not None]
            if not chunk:
                out[key].append(None)
            elif key in last:
                out[key].append(chunk[-1])
            elif key in first:
                out[key].append(chunk[0])
            else:
                out[key].append(sum(chunk) / len(chunk))
    return out
