from datetime import date

import pytest

from app.metrics.intensity import (
    ActivityZones,
    ZoneTime,
    classify,
    delta_to_range,
    intensity_report,
    low_share_pct,
    time_in_zones,
    zone_floors_from_profile,
)

FLOORS = [100, 120, 140, 160, 180]
TODAY = date(2026, 10, 15)  # semaine du 12 au 18 octobre


def test_classify_boundaries() -> None:
    assert classify(99, FLOORS) == 0
    assert classify(100, FLOORS) == 1
    assert classify(119.9, FLOORS) == 1
    assert classify(120, FLOORS) == 2
    assert classify(179, FLOORS) == 4
    assert classify(180, FLOORS) == 5
    assert classify(230, FLOORS) == 5  # au-dessus du maximum : zone 5


def test_time_in_zones_hand_computed() -> None:
    t = list(range(10))
    hr = [90, 100, 110, 120, 130, 140, 150, 160, 170, 180]
    z = time_in_zones(t, hr, FLOORS)
    # 90 -> sous Z1 ; 100,110 -> Z1 ; 120,130 -> Z2 ; 140,150 -> Z3 ; 160,170 -> Z4 ; 180 -> Z5
    assert z.seconds == (1, 2, 2, 2, 2, 1)
    assert z.hr_time_s == 10 and z.total_s == 10
    assert low_share_pct(z.seconds) == pytest.approx(50.0)  # (1 + 2 + 2) / 10


def test_missing_hr_and_pauses() -> None:
    z = time_in_zones([0, 1, 2, 3], [130, None, 130, 130], FLOORS)
    assert z.total_s == 4 and z.hr_time_s == 3
    paused = time_in_zones([0, 100], [130, 130], FLOORS)  # 100 s d'écart = pause
    assert paused.seconds[2] == 15 + 1  # écart plafonné à 15 s + dernier échantillon


def test_empty_and_degenerate_streams() -> None:
    z = time_in_zones([], [], FLOORS)
    assert z.hr_time_s == 0 and low_share_pct(z.seconds) is None
    z = time_in_zones([5, 5, 5], [130, 130, 130], FLOORS)  # horodatages identiques
    assert z.total_s == 1


def test_target_range_is_neutral() -> None:
    assert delta_to_range(None) is None
    assert delta_to_range(77.0) == 0.0
    assert delta_to_range(75.0) == 0.0 and delta_to_range(80.0) == 0.0
    assert delta_to_range(66.0) == pytest.approx(-9.0)
    assert delta_to_range(85.0) == pytest.approx(5.0)


def test_zone_floors_from_profile_and_fallback() -> None:
    good = [{"zone": i, "min_bpm": 90 + 20 * i} for i in range(1, 6)]
    assert zone_floors_from_profile(good, 195) == [110, 130, 150, 170, 190]
    assert zone_floors_from_profile(None, 195) == [98, 117, 137, 156, 176]
    broken = [{"zone": 1, "min_bpm": 100}]
    assert zone_floors_from_profile(broken, 195) == [98, 117, 137, 156, 176]
    decreasing = [{"zone": i, "min_bpm": 200 - 10 * i} for i in range(1, 6)]
    assert zone_floors_from_profile(decreasing, 195) == [98, 117, 137, 156, 176]


def zt(*seconds: float) -> ZoneTime:
    return ZoneTime(tuple(seconds), sum(seconds), sum(seconds))


def test_weekly_report() -> None:
    items = [
        ActivityZones(date(2026, 10, 12), False, zt(0, 600, 200, 100, 0, 0)),  # bas : 800 / 900
        ActivityZones(date(2026, 10, 14), False, zt(0, 0, 0, 300, 0, 0)),  # bas : 0 / 300
        ActivityZones(date(2026, 10, 13), True, zt(0, 0, 0, 0, 0, 5000)),  # course : exclue
        ActivityZones(date(2026, 10, 15), False, None),  # sans flux FC
        # semaine précédente : 770 s bas sur 1000 -> 77 %, dans la cible
        ActivityZones(date(2026, 10, 7), False, zt(0, 500, 270, 230, 0, 0)),
    ]
    r = intensity_report(items, FLOORS, TODAY, weeks=2)
    prev, cur = r.weeks
    assert (prev.week_start, cur.week_start) == (date(2026, 10, 5), date(2026, 10, 12))
    assert cur.low_share_pct == pytest.approx(800 / 1200 * 100)
    assert cur.delta_to_target_pct == pytest.approx(66.6667 - 75, abs=1e-3)
    assert cur.activities_counted == 2
    assert cur.activities_without_hr_stream == 1
    assert cur.races_excluded == 1
    assert cur.zone_seconds[5] == 0  # la FC de course ne pollue pas la répartition
    assert prev.low_share_pct == pytest.approx(77.0) and prev.delta_to_target_pct == 0.0
    assert r.average_low_share_pct == pytest.approx((800 + 770) / (1200 + 1000) * 100)
    assert r.trend.direction == "baisse" and r.trend.delta == pytest.approx(-10.3333, abs=1e-3)
    assert (r.target_min_pct, r.target_max_pct) == (75.0, 80.0)
    assert r.evidence.level == "indicatif" and "pas un verdict" in r.evidence.summary


def test_empty_weeks() -> None:
    r = intensity_report([], FLOORS, TODAY, weeks=3)
    assert len(r.weeks) == 3
    assert all(w.low_share_pct is None and w.hr_time_s == 0 for w in r.weeks)
    assert r.average_low_share_pct is None
    assert r.trend.direction == "indetermine"


def test_no_per_session_judgement_in_output() -> None:
    r = intensity_report(
        [ActivityZones(date(2026, 10, 12), False, zt(0, 100, 0, 0, 0, 0))], FLOORS, TODAY, weeks=1
    )
    dumped = r.model_dump_json()
    assert "activity" not in dumped.replace("activities_", "")  # agrégats hebdomadaires seulement
