import pytest

from app.metrics.climbs import detect_climbs, smooth
from app.metrics.series import downsample, pace_from_speed


def profile(
    points: list[tuple[float, float]], step: float = 10.0
) -> tuple[list[float], list[float]]:
    """Profil linéaire par morceaux [(distance_m, altitude_m), ...], un point tous les `step` m."""
    dist: list[float] = []
    alt: list[float] = []
    for (d0, a0), (d1, a1) in zip(points, points[1:], strict=False):
        n = round((d1 - d0) / step)
        for k in range(n):
            dist.append(d0 + k * step)
            alt.append(a0 + (a1 - a0) * k / n)
    dist.append(points[-1][0])
    alt.append(points[-1][1])
    return dist, alt


def test_smooth() -> None:
    assert smooth([1, 2, 3], 1) == [1, 2, 3]
    assert smooth([0, 3, 0, 3, 0], 3) == pytest.approx([1.5, 1, 2, 1, 1.5])
    assert smooth([], 5) == []


def test_two_clear_climbs_hand_computed() -> None:
    # plat, montée de 150 m sur 1500 m (10 %), descente, montée de 100 m sur 2000 m (5 %), plat
    dist, alt = profile([(0, 100), (1000, 100), (2500, 250), (3500, 150), (5500, 250), (6500, 250)])
    climbs = detect_climbs(dist, alt, smooth_window=1)
    assert len(climbs) == 2
    first, second = climbs
    # le plat d'approche est exclu : la montée commence vers 1,0 km et finit vers 2,5 km
    assert first.start_km == pytest.approx(1.0, abs=0.03) and first.end_km == pytest.approx(
        2.5, abs=0.03
    )
    assert first.gain_m == pytest.approx(150, abs=5) and first.length_m == pytest.approx(
        1500, abs=50
    )
    assert first.avg_grade_pct == pytest.approx(10.0, abs=0.1)
    assert second.gain_m == pytest.approx(100, abs=5) and second.avg_grade_pct == pytest.approx(
        5.0, abs=0.1
    )
    assert second.start_km == pytest.approx(3.5, abs=0.06)


def test_duration_and_heart_rate_of_a_climb() -> None:
    dist, alt = profile([(0, 0), (1000, 100)], step=10)
    t = [d * 0.5 for d in dist]  # 2 m/s
    hr = [120.0 + i * 0.1 for i in range(len(dist))]
    [climb] = detect_climbs(dist, alt, t, hr, smooth_window=1)
    assert climb.duration_s == pytest.approx(500, abs=25)  # (quelques mètres de pied exclus)
    assert climb.avg_hr == pytest.approx(sum(hr) / len(hr), abs=0.5)
    [no_time] = detect_climbs(dist, alt, smooth_window=1)
    assert no_time.duration_s is None and no_time.avg_hr is None


def test_small_bumps_and_gentle_slopes_are_not_climbs() -> None:
    # 40 m de dénivelé : sous le minimum de 50 m
    dist, alt = profile([(0, 100), (500, 140), (1500, 100)])
    assert detect_climbs(dist, alt, smooth_window=1) == []
    # 60 m sur 3 km = 2 % : trop plat pour une côte
    dist, alt = profile([(0, 100), (3000, 160)])
    assert detect_climbs(dist, alt, smooth_window=1) == []
    # tout plat, ou vide
    dist, alt = profile([(0, 100), (2000, 100)])
    assert detect_climbs(dist, alt) == []
    assert detect_climbs([], []) == []
    assert detect_climbs([0.0], [1.0]) == []


def test_sensor_noise_does_not_split_a_climb() -> None:
    dist, alt = profile([(0, 100), (2000, 300)], step=10)
    noisy = [a + (3.0 if i % 2 else -3.0) for i, a in enumerate(alt)]
    [climb] = detect_climbs(dist, noisy)  # lissage par défaut
    assert climb.gain_m == pytest.approx(200, abs=15)
    assert climb.length_m == pytest.approx(2000, abs=120)  # replats d'extrémité exclus


def test_a_dip_smaller_than_hysteresis_keeps_one_climb() -> None:
    dist, alt = profile([(0, 0), (1000, 80), (1200, 70), (2400, 200)])
    [climb] = detect_climbs(dist, alt, smooth_window=1)
    assert climb.gain_m == pytest.approx(200, abs=5) and climb.length_m == pytest.approx(
        2400, abs=60
    )


def test_a_real_dip_splits_into_two_climbs() -> None:
    dist, alt = profile([(0, 0), (1000, 100), (1500, 40), (2500, 140)])
    climbs = detect_climbs(dist, alt, smooth_window=1)
    assert [round(c.gain_m, -1) for c in climbs] == [100, 100]


def test_starts_with_a_descent_and_missing_samples() -> None:
    dist, alt = profile([(0, 300), (1000, 150), (2500, 300)])
    [climb] = detect_climbs(dist, alt, smooth_window=1)
    assert climb.start_km == pytest.approx(1.0, abs=0.03) and climb.gain_m == pytest.approx(
        150, abs=5
    )
    holes_d: list[float | None] = [*dist]
    holes_a: list[float | None] = [*alt]
    holes_a[10] = None
    holes_d[20] = None
    assert len(detect_climbs(holes_d, holes_a, smooth_window=1)) == 1


def test_downsample_and_pace() -> None:
    cols: dict[str, list[float | None]] = {
        "t": [0.0, 1, 2, 3, 4, 5],
        "distance": [0.0, 2, 4, 6, 8, 10],
        "hr": [100.0, 110, None, None, 130, 150],
    }
    out = downsample(cols, 3)  # paquets de 2
    assert out["t"] == [0, 2, 4]
    assert out["distance"] == [2, 6, 10]  # dernière valeur (distance cumulée)
    assert out["hr"] == [105, None, 140]  # moyenne des valeurs présentes ; None si aucune
    assert downsample(cols, 100)["t"] == cols["t"]  # pas de réduction si déjà petit
    assert downsample({"t": []}, 10) == {"t": []}
    assert pace_from_speed(None) is None and pace_from_speed(0.2) is None  # à l'arrêt
    assert pace_from_speed(2.5) == pytest.approx(400)  # 6 min 40 s / km
