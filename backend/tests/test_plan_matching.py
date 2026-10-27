from datetime import date, datetime, timedelta

import pytest

from app.metrics.volume import ActivityRow
from app.plan.matching import (
    A_VENIR,
    FAIT,
    IMPREVU,
    MANQUE,
    PARTIEL,
    PlannedRow,
    compatible,
    match_day,
)

DAY = date(2026, 10, 14)
PAST_TODAY = date(2026, 10, 20)  # le jour est passé
TODAY = DAY  # le jour est aujourd'hui
EARLIER = date(2026, 10, 10)  # le jour est à venir


def act(
    aid: int,
    minutes: float,
    sport: str = "trail_running",
    gain: float | None = None,
    hour: int = 7,
    race: bool = False,
) -> ActivityRow:
    return ActivityRow(
        id=aid,
        day=DAY,
        start_utc=datetime(2026, 10, 14, hour),
        sport=sport,
        duration_s=minutes * 60,
        gain_m=gain,
        is_race=race,
    )


def plan(pid: int, type_: str, minutes: int | None = None, dplus: int | None = None) -> PlannedRow:
    return PlannedRow(id=pid, type=type_, duree_min=minutes, dplus_cible=dplus)


def test_done_with_gaps() -> None:
    m = match_day(DAY, [plan(1, "footing", 60, 100)], [act(10, 66, gain=130)], PAST_TODAY)
    [r] = m.results
    assert r.status == FAIT and r.activity is not None and r.activity.id == 10
    assert r.duration_delta_min == pytest.approx(6.0)
    assert r.duration_ratio == pytest.approx(1.1)
    assert r.dplus_delta_m == 30
    assert m.status == FAIT and m.unplanned == []


def test_partial_below_80_percent() -> None:
    [r] = match_day(DAY, [plan(1, "footing", 60)], [act(10, 47)], PAST_TODAY).results
    assert r.status == PARTIEL  # 47 / 60 = 78 %
    [r] = match_day(DAY, [plan(1, "footing", 60)], [act(10, 48)], PAST_TODAY).results
    assert r.status == FAIT  # 48 / 60 = 80 % exactement : fait


def test_missed_today_and_future() -> None:
    p = [plan(1, "footing", 60)]
    assert match_day(DAY, p, [], PAST_TODAY).status == MANQUE  # jour passé, rien fait
    assert (
        match_day(DAY, p, [], TODAY).status == A_VENIR
    )  # aujourd'hui : la journée n'est pas finie
    assert match_day(DAY, p, [], EARLIER).status == A_VENIR


def test_no_planned_duration_or_dplus_means_no_gaps() -> None:
    [r] = match_day(DAY, [plan(1, "longue")], [act(10, 120, gain=900)], PAST_TODAY).results
    assert r.status == FAIT and r.duration_delta_min is None and r.dplus_delta_m is None


def test_unplanned_day() -> None:
    m = match_day(DAY, [], [act(10, 45)], PAST_TODAY)
    assert m.status == IMPREVU and [a.id for a in m.unplanned] == [10] and m.results == []
    assert match_day(DAY, [], [], PAST_TODAY).status is None  # rien de prévu, rien de fait


def test_rest_day() -> None:
    rest = [plan(1, "repos")]
    assert match_day(DAY, rest, [], PAST_TODAY).status == FAIT  # repos respecté
    assert match_day(DAY, rest, [], TODAY).status == A_VENIR
    m = match_day(DAY, rest, [act(10, 40)], PAST_TODAY)  # sortie un jour de repos
    assert m.status == IMPREVU and m.results[0].status == IMPREVU
    assert [a.id for a in m.unplanned] == [10]


def test_several_activities_closest_duration_wins() -> None:
    acts = [act(10, 25, hour=6), act(11, 58, hour=12)]
    m = match_day(DAY, [plan(1, "footing", 60)], acts, PAST_TODAY)
    assert m.results[0].activity is not None and m.results[0].activity.id == 11
    assert [a.id for a in m.unplanned] == [10]  # l'autre sortie est « imprévue »
    assert m.status == FAIT  # le statut du jour reste celui de la séance prévue


def test_two_planned_two_done_longest_first() -> None:
    planned = [plan(1, "footing", 50), plan(2, "longue", 150)]
    acts = [act(10, 55, hour=6), act(11, 140, hour=9)]
    m = match_day(DAY, planned, acts, PAST_TODAY)
    by_plan = {r.planned_id: r.activity.id for r in m.results if r.activity}
    assert by_plan == {1: 10, 2: 11}
    assert m.status == FAIT


def test_mixed_day_is_partial() -> None:
    planned = [plan(1, "footing", 50), plan(2, "renfo", 30)]
    m = match_day(DAY, planned, [act(10, 50)], PAST_TODAY)  # renfo manqué
    assert [r.status for r in m.results] == [FAIT, MANQUE]
    assert m.status == PARTIEL


def test_incompatible_sport_is_missed_and_unplanned() -> None:
    m = match_day(DAY, [plan(1, "footing", 60)], [act(10, 90, sport="cycling")], PAST_TODAY)
    assert m.results[0].status == MANQUE and m.results[0].activity is None
    assert [a.id for a in m.unplanned] == [10]


def test_strength_and_other() -> None:
    planned = [plan(1, "renfo", 30)]
    m = match_day(DAY, planned, [act(10, 35, sport="strength_training")], PAST_TODAY)
    assert m.results[0].status == FAIT
    m = match_day(DAY, [plan(1, "autre", 60)], [act(10, 60, sport="cycling")], PAST_TODAY)
    assert m.results[0].status == FAIT


def test_a_race_matches_any_running_type() -> None:
    assert compatible("course", act(1, 200, sport="weird", race=True))
    assert compatible("longue", act(1, 200, sport="weird", race=True))
    assert not compatible("renfo", act(1, 200, sport="weird", race=True))
    assert not compatible("repos", act(1, 60))
    assert not compatible("footing", act(1, 60, sport="hiking"))


def test_activity_used_only_once() -> None:
    planned = [plan(1, "footing", 60), plan(2, "footing", 40)]
    m = match_day(DAY, planned, [act(10, 58)], PAST_TODAY)
    assert m.results[0].status == FAIT and m.results[1].status == MANQUE


def test_deterministic_tie_break_on_start_time() -> None:
    acts = [act(11, 60, hour=12), act(10, 60, hour=6)]
    m = match_day(DAY, [plan(1, "footing", 60)], acts, PAST_TODAY)
    assert m.results[0].activity is not None and m.results[0].activity.id == 10  # la plus tôt
    assert timedelta(0) == timedelta(0)
