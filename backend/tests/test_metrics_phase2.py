"""Métriques de phase 2 sur données synthétiques : valeurs attendues calculées à la main."""

import math
from datetime import date, datetime, timedelta

import pytest

from app.metrics.fatigue import fatigue_report, is_strong_descent
from app.metrics.fitness import FitnessPoint
from app.metrics.fueling import Outing, fueling_series
from app.metrics.gap import (
    ascent_speed_m_per_h,
    flat_equivalent_ratio,
    minetti_cost,
    pace_summary,
)
from app.metrics.monotony import MONOTONY_REFERENCE, monotony_report, week_stats
from app.metrics.race_goal import predictions, project, recent_volume, tsb_projection
from app.metrics.strength import strength_report
from app.metrics.volume import ActivityRow

# --- monotonie et tension -----------------------------------------------------------------------


def test_week_stats_hand_computed() -> None:
    # une seule grosse journée : moyenne 10, écart-type √600 -> monotonie 10/√600
    load, mono, strain = week_stats([0, 0, 0, 0, 0, 0, 70])
    assert load == 70
    assert mono == pytest.approx(10 / math.sqrt(600))  # 0,4082
    assert strain == pytest.approx(70 * 10 / math.sqrt(600))  # 28,58
    # semaine très régulière : moyenne 100, variances 4 × 100 + 3 × 0 sur 7
    load, mono, strain = week_stats([90, 100, 110, 100, 90, 110, 100])
    assert load == 700
    assert mono == pytest.approx(100 / math.sqrt(400 / 7))  # 13,23
    assert strain == pytest.approx(700 * 13.2288, rel=1e-3)


def test_identical_or_empty_weeks_have_no_monotony() -> None:
    assert week_stats([100.0] * 7)[1:] == (None, None)
    assert week_stats([0.0] * 7) == (0.0, None, None)


def build_daily() -> dict[date, float]:
    daily: dict[date, float] = {}
    for start in (date(2026, 9, 21), date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 12)):
        for offset in (0, 2, 5):  # lundi, mercredi, samedi : 100 points chacun = 300 / semaine
            daily[start + timedelta(days=offset)] = 100.0
    for offset, load in enumerate([90, 100, 110, 100, 90, 110, 100]):
        daily[date(2026, 10, 19) + timedelta(days=offset)] = float(load)
    return daily


def test_soft_alert_needs_monotony_above_2_and_a_high_load() -> None:
    report = monotony_report(
        build_daily(), date(2026, 9, 21), date(2026, 10, 25), date(2026, 10, 25), 2
    )
    previous, current = report.weeks
    # semaine du 12/10 : 300 points, monotonie 0,866, charge identique à ses semaines de référence
    assert previous.week_start == date(2026, 10, 12) and previous.complete
    assert previous.monotony == pytest.approx(0.866, abs=1e-3)
    assert previous.high_load is False and previous.soft_alert is False
    # semaine du 19/10 : 700 > 1,10 × 300 et monotonie 13,2 > 2 -> alerte douce (information)
    assert current.week_start == date(2026, 10, 19)
    assert current.load == 700 and current.monotony == pytest.approx(13.229, abs=1e-3)
    assert current.high_load is True and current.soft_alert is True
    assert current.message and "information" in current.message
    assert report.reference == MONOTONY_REFERENCE == 2.0
    assert "jamais un prédicteur de blessure" in report.evidence.summary
    assert report.evidence.level == "indicatif"


def test_no_alert_when_high_monotony_but_load_is_not_high() -> None:
    daily = build_daily()
    for start in (date(2026, 9, 21), date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 12)):
        for offset, load in enumerate([100, 100, 100, 100, 100, 100, 101]):
            daily[start + timedelta(days=offset)] = float(load)
    report = monotony_report(daily, date(2026, 9, 21), date(2026, 10, 25), date(2026, 10, 25), 1)
    current = report.weeks[0]
    assert current.monotony is not None and current.monotony > 2
    assert current.load == 700 and current.high_load is False  # 700 < 1,10 × 701
    assert current.soft_alert is False and current.message is None


def test_history_too_short_gives_no_high_load_judgement() -> None:
    daily = {date(2026, 10, 19) + timedelta(days=d): 50.0 * (d % 2) for d in range(7)}
    report = monotony_report(daily, date(2026, 10, 19), date(2026, 10, 25), date(2026, 10, 25), 1)
    assert report.weeks[0].high_load is None and report.weeks[0].soft_alert is False


def test_weeks_before_the_first_data_have_no_monotony() -> None:
    report = monotony_report({}, None, date(2026, 10, 25), date(2026, 10, 25), 3)
    assert [w.monotony for w in report.weeks] == [None, None, None]
    assert [w.load for w in report.weeks] == [0, 0, 0]


# --- GAP / NGP ----------------------------------------------------------------------------------


def test_minetti_cost_known_values() -> None:
    assert minetti_cost(0) == pytest.approx(3.6)
    assert minetti_cost(0.1) == pytest.approx(5.968214, abs=1e-6)  # calculé terme à terme
    assert minetti_cost(-0.1) == pytest.approx(2.151706, abs=1e-6)
    assert flat_equivalent_ratio(0.1) == pytest.approx(5.968214 / 3.6)
    assert minetti_cost(0.9) == pytest.approx(minetti_cost(0.45))  # borné à ±45 %
    # descente modérée moins coûteuse qu'à plat ; forte descente à nouveau plus coûteuse
    assert minetti_cost(-0.2) < minetti_cost(-0.1) < minetti_cost(0)
    assert minetti_cost(-0.45) > minetti_cost(-0.2)


def line(speed: float, grade: float, seconds: int) -> tuple[list[float], list[float], list[float]]:
    t = [float(i) for i in range(seconds)]
    dist = [speed * i for i in t]
    alt = [100.0 + grade * d for d in dist]
    return t, dist, alt


def test_flat_run_gap_equals_pace() -> None:
    t, dist, alt = line(3.0, 0.0, 200)
    s = pace_summary(t, dist, alt)
    assert s is not None
    assert s.pace_s_per_km == pytest.approx(1000 / 3)
    assert s.gap_s_per_km == pytest.approx(1000 / 3, rel=1e-6)
    assert s.ngp_s_per_km == pytest.approx(1000 / 3, rel=1e-3)  # vitesse constante : NGP = allure


def test_constant_ten_percent_climb_gap_is_faster_by_the_cost_ratio() -> None:
    t, dist, alt = line(2.0, 0.10, 300)
    s = pace_summary(t, dist, alt)
    assert s is not None and s.pace_s_per_km == pytest.approx(500)
    assert s.gap_s_per_km == pytest.approx(500 / (5.968214 / 3.6), rel=0.03)  # ≈ 301,6 s/km


def test_stops_are_not_counted_as_moving_time() -> None:
    t, dist, alt = line(3.0, 0.0, 100)
    t2 = t + [100.0 + i for i in range(1, 21)] + [120.0 + i for i in range(1, 101)]
    d2 = dist + [dist[-1]] * 20 + [dist[-1] + 3.0 * i for i in range(1, 101)]
    a2 = alt + [100.0] * 120
    s = pace_summary(t2, d2, a2)
    assert s is not None
    assert s.moving_time_s == pytest.approx(199, abs=2)  # 20 s d'arrêt exclues
    assert s.pace_s_per_km == pytest.approx(1000 / 3, rel=0.01)


def test_ngp_penalises_variable_pace() -> None:
    # 120 s alternées 60 s à 2 m/s et 60 s à 4 m/s, à plat : moyenne 3 m/s -> allure 333 s/km
    t = [float(i) for i in range(241)]
    dist = [0.0]
    for i in range(1, 241):
        dist.append(dist[-1] + (2.0 if (i - 1) // 60 % 2 == 0 else 4.0))
    s = pace_summary(t, dist, [100.0] * 241)
    assert s is not None
    assert s.pace_s_per_km == pytest.approx(1000 / 3, rel=1e-6)
    assert s.ngp_s_per_km is not None and s.pace_s_per_km is not None
    assert 250 < s.ngp_s_per_km < s.pace_s_per_km - 5


def test_missing_data_gives_no_pace() -> None:
    assert pace_summary([0, 1], [0, 3], [1, 1]) is None  # trop court
    assert pace_summary([0.0, 1.0, 2.0], [None, None, None], [1.0, 1.0, 1.0]) is None
    t, dist, _ = line(3.0, 0.0, 50)
    assert pace_summary(t, dist, [None] * 50) is None


def test_ascent_speed() -> None:
    assert ascent_speed_m_per_h(100, 400) == pytest.approx(900)
    assert ascent_speed_m_per_h(100, 0) is None and ascent_speed_m_per_h(100, None) is None


# --- fatigue musculaire -------------------------------------------------------------------------


def row(rid: int, day: date, loss: float | None, km: float = 10) -> ActivityRow:
    return ActivityRow(
        id=rid, day=day, start_utc=datetime.combine(day, datetime.min.time()),
        sport="trail_running", duration_s=3600, distance_m=km * 1000, gain_m=300, loss_m=loss,
    )  # fmt: skip


def test_strong_descent_rule() -> None:
    assert is_strong_descent(800, 30_000) is True  # >= 800 m
    assert is_strong_descent(450, 5_000) is True  # 90 m/km avec >= 400 m
    assert is_strong_descent(450, 10_000) is False  # 45 m/km
    assert is_strong_descent(300, 1_000) is False  # 300 m/km mais < 400 m
    assert is_strong_descent(None, 10_000) is False and is_strong_descent(0, 10_000) is False


def test_fatigue_weekly_loss_strong_sessions_and_48h_soreness() -> None:
    today = date(2026, 10, 15)  # jeudi
    rows = [
        row(1, date(2026, 10, 6), 900),  # mardi : fort D−, courbatures attendues le 08/10
        row(2, date(2026, 10, 8), 200),
        row(3, date(2026, 10, 13), 1000),  # mardi : fort D−, courbatures attendues le 15/10
        row(4, date(2026, 10, 14), 100),
        row(5, date(2026, 9, 1), 5000),  # hors fenêtre de 2 semaines
    ]
    report = fatigue_report(rows, {date(2026, 10, 8): 3, date(2026, 10, 15): 7}, today, 2)
    assert [(w.week_start, w.loss_m, w.sessions, w.strong_sessions) for w in report.weeks] == [
        (date(2026, 10, 5), 1100.0, 2, 1),
        (date(2026, 10, 12), 1100.0, 2, 1),
    ]
    first, second = report.strong_sessions
    assert (first.activity_id, first.soreness_date, first.soreness) == (1, date(2026, 10, 8), 3)
    assert (second.activity_id, second.soreness_date, second.soreness) == (3, date(2026, 10, 15), 7)
    assert second.loss_per_km == pytest.approx(100)


def test_soreness_not_due_yet_or_not_entered_is_none() -> None:
    today = date(2026, 10, 15)
    rows = [row(1, date(2026, 10, 14), 900), row(2, date(2026, 10, 10), 900)]
    report = fatigue_report(rows, {}, today, 2)
    assert [s.soreness for s in report.strong_sessions] == [None, None]
    assert report.strong_sessions[1].soreness_date == date(2026, 10, 16)  # dans le futur


def test_easy_days_hint_only_within_three_days_after_a_strong_descent() -> None:
    today = date(2026, 10, 15)
    recent = fatigue_report([row(1, date(2026, 10, 14), 900)], {}, today, 2)
    assert recent.suggestion is not None
    assert (recent.suggestion.easy_from, recent.suggestion.easy_until) == (
        date(2026, 10, 15),
        date(2026, 10, 17),
    )
    assert "2 à 3 jours faciles" in recent.suggestion.message
    assert "pas une prescription" in recent.suggestion.message
    old = fatigue_report([row(1, date(2026, 10, 12), 900)], {}, today, 2)
    assert old.suggestion is None
    assert recent.evidence.level == "indicatif"


# --- renforcement -------------------------------------------------------------------------------


def test_strength_counts_max_of_detected_and_manual_per_day() -> None:
    mon, tue, wed = date(2026, 10, 12), date(2026, 10, 13), date(2026, 10, 14)
    report = strength_report([mon, tue], [tue, wed, wed], 2, date(2026, 10, 15), 2)
    previous, current = report.weeks
    assert previous.count == 0 and previous.target_met is False
    # lundi : max(1,0)=1 ; mardi : max(1,1)=1 (même séance) ; mercredi : max(0,2)=2
    assert (current.detected, current.manual, current.count) == (2, 3, 4)
    assert current.target_met is True and current.complete is False


def test_strength_without_target_never_judges() -> None:
    report = strength_report([], [], None, date(2026, 10, 15), 1)
    assert report.weeks[0].target is None and report.weeks[0].target_met is None


# --- nutrition ----------------------------------------------------------------------------------


def outing(
    rid: int, day: int, hours: float, carbs: float | None = None, gi: int | None = None
) -> Outing:
    return Outing(
        activity_id=rid, day=date(2026, 9, day), duration_s=hours * 3600, distance_km=20,
        entry_id=rid if carbs is not None else None, carbs_g_per_h=carbs, gi_score=gi,
    )  # fmt: skip


def test_fueling_series_tracks_progression_on_long_outings_only() -> None:
    outings = [
        outing(1, 1, 4.0, 60, 4),
        outing(2, 8, 2.0, 90, 5),  # trop courte : ignorée
        outing(3, 15, 3.0, 70, 3),
        outing(4, 22, 3.5),  # sortie longue sans saisie
        outing(5, 29, 4.0, 80, 2),
    ]
    series = fueling_series(outings)
    assert [p.activity_id for p in series.points] == [1, 3, 4, 5]
    assert [p.carbs_change_g_per_h for p in series.points] == [None, 10, None, 10]
    assert series.points[0].carbs_total_g == pytest.approx(240)  # 60 g/h × 4 h
    assert series.missing == 1
    assert "ne fixe aucune cible" in series.evidence.summary
    assert [p.activity_id for p in fueling_series(outings, min_hours=3.2).points] == [1, 4, 5]


# --- objectif de course -------------------------------------------------------------------------


def test_projection_closed_forms() -> None:
    last = FitnessPoint(date=date(2026, 10, 15), load=0, ctl=50, atl=60, tsb=-10)
    ctl, atl, tsb = project(last, 0.0, 14)  # CTL = 50·e^(−14/42), ATL = 60·e^(−14/7)
    assert ctl == pytest.approx(50 * math.exp(-1 / 3))
    assert atl == pytest.approx(60 * math.exp(-2))
    assert tsb == pytest.approx(50 * math.exp(-1 / 3) - 60 * math.exp(-2))  # ≈ +27,7
    ctl, atl, _ = project(last, 40.0, 21)  # x_n = L + (x_0 − L)·e^(−n/τ)
    assert ctl == pytest.approx(40 + 10 * math.exp(-0.5))
    assert atl == pytest.approx(40 + 20 * math.exp(-3))
    assert project(last, 40.0, 0) == (50, 60, -10)


def test_tsb_projection_scenarios_and_limits() -> None:
    last = FitnessPoint(date=date(2026, 10, 15), load=0, ctl=50, atl=60, tsb=-10)
    proj = tsb_projection(last, 40.0, date(2026, 11, 8))
    assert proj is not None and proj.days == 24
    rest, kept = proj.scenarios
    assert rest.daily_load == 0 and kept.daily_load == 40
    assert rest.tsb > kept.tsb
    assert "pas une prévision de forme" in proj.evidence.summary
    assert tsb_projection(last, 40.0, date(2026, 10, 15)) is None  # course passée ou aujourd'hui
    assert tsb_projection(None, 40.0, date(2026, 11, 8)) is None
    assert tsb_projection(last, 40.0, date(2028, 1, 1)) is None  # horizon trop lointain


def test_recent_volume_against_the_race_profile() -> None:
    today = date(2026, 10, 28)  # fenêtre de 28 jours : du 01/10 au 28/10 inclus

    def act(rid: int, day: date, km: float, gain: float) -> ActivityRow:
        return ActivityRow(
            id=rid, day=day, start_utc=datetime.combine(day, datetime.min.time()),
            sport="trail_running", duration_s=3600, distance_m=km * 1000, gain_m=gain,
        )  # fmt: skip

    rows = [
        act(1, date(2026, 10, 3), 20, 1000),
        act(2, date(2026, 10, 20), 12, 400),
        act(3, date(2026, 9, 30), 99, 9000),  # la veille de la fenêtre : exclue
    ]
    v = recent_volume(rows, today, race_km=31, race_dplus=1600)
    assert v.window_days == 28
    assert v.distance_km == pytest.approx(32) and v.dplus_m == pytest.approx(1400)
    assert v.avg_weekly_km == pytest.approx(8) and v.avg_weekly_dplus_m == pytest.approx(350)
    assert v.longest_km == pytest.approx(20) and v.longest_dplus_m == pytest.approx(1000)
    assert v.avg_weekly_km_vs_race_pct == pytest.approx(8 / 31 * 100)
    assert v.avg_weekly_dplus_vs_race_pct == pytest.approx(350 / 1600 * 100)
    assert v.longest_km_vs_race_pct == pytest.approx(20 / 31 * 100)
    assert v.longest_dplus_vs_race_pct == pytest.approx(62.5)
    assert "pas un verdict" in v.evidence.summary
    bare = recent_volume(rows, today, race_km=None, race_dplus=None)
    assert bare.longest_km_vs_race_pct is None and bare.avg_weekly_dplus_vs_race_pct is None


def test_predictions_are_labelled_as_watch_estimates() -> None:
    got = predictions({"time5K": 1300, "time10K": None, "timeHalfMarathon": 6000})
    assert [(p.label, p.seconds) for p in got] == [("5 km", 1300), ("Semi-marathon", 6000)]
    assert all("estimation de la montre" in p.note for p in got)
    assert predictions({}) == []
