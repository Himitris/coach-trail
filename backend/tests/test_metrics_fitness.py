import math
from datetime import date, timedelta

import pytest

from app.metrics.fitness import (
    CTL_DAYS,
    HrParams,
    fitness_report,
    fitness_series,
    hr_params,
    load_from_average,
    load_from_stream,
)

# FC max 190, repos 50, seuil 170 : y_seuil = 120 / 140
P = HrParams(fc_max=190, fc_rest=50, fc_threshold=170)
D0 = date(2026, 1, 1)


def constant_stream(hr: float, seconds: int) -> tuple[list[float | None], list[float | None]]:
    return [float(i) for i in range(seconds)], [hr] * seconds


def test_one_hour_at_threshold_is_100_points() -> None:
    t, hr = constant_stream(170, 3600)
    load, covered = load_from_stream(t, hr, P)
    assert load == pytest.approx(100.0)
    assert covered == 3600


def test_half_hour_below_threshold_hand_computed() -> None:
    # (140 - 50) / (170 - 50) = 0,75 ; 0,75² = 0,5625 ; 0,5 h × 0,5625 × 100 = 28,125
    t, hr = constant_stream(140, 1800)
    assert load_from_stream(t, hr, P)[0] == pytest.approx(28.125)
    # estimation par FC moyenne : même résultat pour une séance constante
    assert load_from_average(1800, 140, P) == pytest.approx(28.125)


def test_clamping_and_gaps() -> None:
    t, hr = constant_stream(30, 3600)  # sous la FC repos
    assert load_from_stream(t, hr, P)[0] == 0
    # au-dessus de FC max : y borné à 1,1 -> (1,1 / (120/140))² = 1,6469 par heure
    t, hr = constant_stream(300, 3600)
    expected = (1.1 / (120 / 140)) ** 2 * 100
    assert load_from_stream(t, hr, P)[0] == pytest.approx(expected)
    # trou de capteur : non compté ; pause longue plafonnée à 15 s
    load, covered = load_from_stream([0, 1, 2, 3], [170, None, 170, 170], P)
    assert covered == 3
    load, covered = load_from_stream([0, 600], [170, 170], P)
    assert covered == 16
    assert load_from_stream([], [], P) == (0.0, 0.0)


def test_hr_params_substitutions_are_reported() -> None:
    p, notes = hr_params(190, None, None)
    assert p.fc_rest == 55 and p.fc_threshold == 167  # 88 % de 190 = 167,2
    assert (
        len(notes) == 2 and "FC repos absente" in notes[0] and "Seuil lactique absent" in notes[1]
    )
    p, notes = hr_params(190, 50, 170)
    assert notes == [] and p.fc_threshold == 170
    p, notes = hr_params(190, 50, 195)  # seuil au-dessus de la FC max : incohérent
    assert p.fc_threshold == 169 and "incohérent" in notes[0]  # 50 + 0,85 × 140 = 169


def test_ctl_atl_single_load_hand_computed() -> None:
    series = fitness_series({D0: 100.0}, D0, D0 + timedelta(days=1))
    d0, d1 = series
    # CTL = 100 × (1 - e^(-1/42)) = 2,35283 ; ATL = 100 × (1 - e^(-1/7)) = 13,31221
    assert d0.ctl == pytest.approx(2.35283, abs=1e-4)
    assert d0.atl == pytest.approx(13.31221, abs=1e-4)
    assert d0.tsb == pytest.approx(2.35283 - 13.31221, abs=1e-4)
    # jour sans charge : chaque moyenne est multipliée par e^(-1/τ)
    assert d1.ctl == pytest.approx(2.29747, abs=1e-4)
    assert d1.atl == pytest.approx(11.54011, abs=1e-4)
    assert d1.tsb == pytest.approx(-9.24264, abs=1e-3)


def test_ctl_matches_closed_form_convolution() -> None:
    loads = {D0: 120.0, D0 + timedelta(days=3): 80.0, D0 + timedelta(days=10): 60.0}
    end = D0 + timedelta(days=30)
    last = fitness_series(loads, D0, end)[-1]
    k42, k7 = 1 - math.exp(-1 / 42), 1 - math.exp(-1 / 7)
    exp_ctl = sum(v * k42 * math.exp(-(end - d).days / 42) for d, v in loads.items())
    exp_atl = sum(v * k7 * math.exp(-(end - d).days / 7) for d, v in loads.items())
    assert last.ctl == pytest.approx(exp_ctl)
    assert last.atl == pytest.approx(exp_atl)
    assert last.tsb == pytest.approx(exp_ctl - exp_atl)


def test_constant_load_converges() -> None:
    loads = {D0 + timedelta(days=i): 50.0 for i in range(400)}
    last = fitness_series(loads, D0, D0 + timedelta(days=399))[-1]
    assert last.ctl == pytest.approx(50.0, abs=0.01)
    assert last.atl == pytest.approx(50.0, abs=1e-6)
    assert last.tsb == pytest.approx(0.0, abs=0.01)


def test_one_day_series() -> None:
    [p] = fitness_series({}, D0, D0)
    assert (p.ctl, p.atl, p.tsb, p.load) == (0, 0, 0, 0)


def test_report_ramp_and_window() -> None:
    n = 100
    loads = {D0 + timedelta(days=i): 100.0 for i in range(n)}
    end = D0 + timedelta(days=n - 1)
    start = D0 + timedelta(days=60)
    r = fitness_report(loads, D0, start, end)
    assert r.points[0].date == start and r.points[-1].date == end
    # CTL_i = 100 (1 - e^(-(i+1)/42)) ; rampe = CTL(99) - CTL(71)
    expected = 100 * (math.exp(-72 / 42) - math.exp(-100 / 42))
    assert r.ctl_ramp_4w == pytest.approx(expected)
    assert r.ctl_ramp_per_week == pytest.approx(expected / 4)
    assert r.history_days == n
    assert r.trend.direction == "hausse"
    assert not r.warnings  # 60 jours d'historique avant le début : échauffement suffisant
    assert r.evidence.level == "indicatif"
    assert "pas un verdict" in r.evidence.summary


def test_report_warns_on_short_history() -> None:
    loads = {D0 + timedelta(days=i): 40.0 for i in range(10)}
    end = D0 + timedelta(days=9)
    r = fitness_report(loads, D0, D0, end)
    assert r.ctl_ramp_4w is None
    assert any("sous-estimé" in w for w in r.warnings)
    assert any("rampe" in w for w in r.warnings)
    assert len(r.points) == 10
    assert CTL_DAYS == 42


def test_report_without_data() -> None:
    r = fitness_report({}, None, D0, D0 + timedelta(days=5), ["note"])
    assert r.points == [] and r.ctl_ramp_4w is None and r.history_days == 0
    assert r.warnings[0] == "note" and "Aucune séance" in r.warnings[-1]
    # données qui commencent après la fin de la période demandée
    r = fitness_report(
        {D0 + timedelta(days=9): 50.0}, D0 + timedelta(days=9), D0, D0 + timedelta(days=5)
    )
    assert r.points == []


def test_report_start_before_first_data_starts_at_origin() -> None:
    loads = {D0 + timedelta(days=5): 100.0}
    r = fitness_report(loads, D0 + timedelta(days=5), D0, D0 + timedelta(days=6))
    assert [p.ctl for p in r.points[:5]] == [0, 0, 0, 0, 0]  # avant la première séance
    assert r.points[5].ctl == pytest.approx(2.35283, abs=1e-4)
