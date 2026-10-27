from datetime import date, datetime, timedelta

import pytest

from app.metrics.models import mean, monday, pct_change
from app.metrics.volume import ActivityRow, totals, week_report

TODAY = date(2026, 10, 15)  # jeudi ; la semaine du 5 au 11 octobre est terminée


def row(
    day: date,
    hours: float,
    km: float | None = None,
    gain: float | None = None,
    loss: float | None = None,
    race: bool = False,
    rid: int = 1,
) -> ActivityRow:
    return ActivityRow(
        id=rid,
        day=day,
        start_utc=datetime.combine(day, datetime.min.time()),
        sport="trail_running",
        duration_s=hours * 3600,
        distance_m=None if km is None else km * 1000,
        gain_m=gain,
        loss_m=loss,
        is_race=race,
    )


def dataset() -> list[ActivityRow]:
    return [
        # semaine du 5 au 11 octobre : 3 h, 30 km, D+ 1200 m
        row(date(2026, 10, 6), 1, 10, 400, 380, rid=1),
        row(date(2026, 10, 9), 2, 20, 800, 790, rid=2),
        # semaine précédente (28 sept.–4 oct.) : 2,5 h
        row(date(2026, 9, 30), 2.5, 15, 600, 590, rid=3),
        # 21–27 sept. : 2 h ; 14–20 sept. : 3 h ; 7–13 sept. : 1 h
        row(date(2026, 9, 22), 2, 12, 300, 300, rid=4),
        row(date(2026, 9, 15), 3, 20, 700, 700, rid=5),
        row(date(2026, 9, 8), 1, 8, 100, 100, rid=6),
    ]


def test_helpers() -> None:
    assert monday(date(2026, 10, 11)) == date(2026, 10, 5)  # dimanche -> lundi
    assert monday(date(2026, 10, 5)) == date(2026, 10, 5)
    assert pct_change(110, 100) == pytest.approx(10.0)
    assert pct_change(5, 0) is None and pct_change(None, 3) is None
    assert mean([1.0, None, 3.0]) == 2.0 and mean([None]) is None


def test_week_totals_and_comparisons() -> None:
    r = week_report(dataset(), date(2026, 10, 8), TODAY)  # un jeudi quelconque de la semaine
    assert (r.week_start, r.week_end) == (date(2026, 10, 5), date(2026, 10, 11))
    assert r.complete
    assert r.current.time_s == 10800 and r.current.sessions == 2
    assert r.current.distance_m == 30000
    assert (r.current.gain_m, r.current.loss_m) == (1200, 1170)
    assert r.current.gain_per_km == pytest.approx(40.0)  # 1200 m / 30 km
    assert r.previous.time_s == 9000
    # (10800 - 9000) / 9000 = +20 %
    assert r.time_change_vs_previous_pct == pytest.approx(20.0)
    assert r.exceeds_reference is True
    # moyenne des 4 semaines précédentes : (9000 + 7200 + 10800 + 3600) / 4 = 7650 s
    assert r.avg_4w is not None and r.avg_4w.time_s == pytest.approx(7650)
    assert r.time_change_vs_avg4w_pct == pytest.approx((10800 - 7650) / 7650 * 100)
    assert r.trend.direction == "hausse"
    assert r.reference_rise_pct == 10.0
    assert r.evidence.level == "etabli" and "pas un prédicteur de blessure" in r.evidence.summary


def test_rise_within_reference() -> None:
    rows = [row(date(2026, 9, 30), 10, rid=1), row(date(2026, 10, 6), 10.5, rid=2)]  # +5 %
    r = week_report(rows, date(2026, 10, 6), TODAY)
    assert r.time_change_vs_previous_pct == pytest.approx(5.0)
    assert r.exceeds_reference is False


def test_empty_week_and_missing_references() -> None:
    r = week_report([], date(2026, 10, 6), TODAY)
    assert r.current.time_s == 0 and r.current.sessions == 0
    assert r.current.gain_per_km is None
    assert r.time_change_vs_previous_pct is None and r.time_change_vs_avg4w_pct is None
    assert r.avg_4w is None
    assert r.exceeds_reference is None
    assert r.trend.direction == "indetermine"


def test_previous_week_empty_gives_no_percentage() -> None:
    rows = [row(date(2026, 10, 6), 2, rid=1), row(date(2026, 9, 16), 3, rid=2)]
    r = week_report(rows, date(2026, 10, 6), TODAY)
    assert r.previous.sessions == 0
    assert r.time_change_vs_previous_pct is None  # jamais une division par zéro
    assert r.exceeds_reference is None
    assert r.time_change_vs_avg4w_pct == pytest.approx((7200 - 2700) / 2700 * 100)


def test_current_week_is_flagged_partial() -> None:
    rows = [row(date(2026, 10, 7), 1, rid=1), row(date(2026, 10, 13), 5, rid=2)]
    r = week_report(rows, TODAY, TODAY)  # semaine en cours (12–18 octobre)
    assert not r.complete
    assert r.exceeds_reference is None  # pas de repère sur une semaine inachevée
    assert "partielle" in r.evidence.summary


def test_single_day_and_missing_fields() -> None:
    rows = [row(date(2026, 10, 6), 1.5, km=None, gain=None)]
    r = week_report(rows, date(2026, 10, 6), TODAY)
    assert r.current.time_s == 5400 and r.current.distance_m == 0
    assert r.current.gain_per_km is None  # pas de distance : pas de D+/km


def test_races_count_in_volume() -> None:
    rows = [row(date(2026, 10, 10), 4, 31, 1600, 1600, race=True)]
    r = week_report(rows, date(2026, 10, 10), TODAY)
    assert r.current.time_s == 14400 and r.current.gain_m == 1600


def test_week_boundaries_monday_to_sunday() -> None:
    rows = [
        row(date(2026, 10, 4), 1, rid=1),  # dimanche -> semaine précédente
        row(date(2026, 10, 5), 1, rid=2),  # lundi
        row(date(2026, 10, 11), 1, rid=3),  # dimanche
        row(date(2026, 10, 12), 1, rid=4),  # lundi suivant
    ]
    r = week_report(rows, date(2026, 10, 5), TODAY)
    assert r.current.sessions == 2 and r.previous.sessions == 1
    assert totals([], 4).time_s == 0
    assert (date(2026, 10, 12) - timedelta(days=7)) == r.week_start
