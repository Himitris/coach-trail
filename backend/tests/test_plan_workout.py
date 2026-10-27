from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Activity, ActivityStream
from app.plan.workout import WorkoutInput, classify_workout, conformity, manual_workout
from app.sync.dedup import assign_dedup_groups
from app.sync.streams import encode_stream

FC_MAX = 195
EASY = 140  # 72 % de la FC max
HARD = 175  # 90 % de la FC max
TODAY = date(2026, 10, 15)


def profile(segments: list[tuple[int, int]]) -> tuple[list[float | None], list[float | None]]:
    """FC en créneaux (minutes, bpm), un échantillon par seconde."""
    t: list[float | None] = []
    hr: list[float | None] = []
    clock = 0
    for minutes, bpm in segments:
        for _ in range(minutes * 60):
            t.append(float(clock))
            hr.append(float(bpm))
            clock += 1
    return t, hr


def run(segments: list[tuple[int, int]], gain: float | None = None, race: bool = False):  # type: ignore[no-untyped-def]
    t, hr = profile(segments)
    return classify_workout(
        WorkoutInput(duration_s=len(t), is_race=race, hr_avg=140, gain_m=gain, t=t, hr=hr), FC_MAX
    )


def test_easy_run_is_a_footing() -> None:
    found = run([(50, EASY)])
    assert found and found.type == "footing" and found.confidence == "bonne"
    assert found.hard_min == 0


def test_steady_effort_after_warmup_is_threshold() -> None:
    found = run([(15, EASY), (25, HARD), (10, EASY)])
    assert found and found.type == "seuil"
    assert found.longest_block_min and 23 <= found.longest_block_min <= 27
    assert "Effort continu" in found.reasons[0]


def test_repeated_short_efforts_are_intervals() -> None:
    segments = [(15, EASY)]
    for _ in range(5):
        segments += [(4, HARD), (3, EASY)]
    found = run(segments + [(10, EASY)])
    assert found and found.type == "fractionne" and found.blocks == 5


def test_intervals_on_a_steep_course_are_hill_repeats() -> None:
    segments = [(15, EASY)]
    for _ in range(5):
        segments += [(4, HARD), (3, EASY)]
    found = run(segments, gain=900)
    assert found and found.type == "cotes"


def test_long_easy_run() -> None:
    found = run([(110, EASY)])
    assert found and found.type == "longue"


def test_long_run_with_a_little_effort_stays_long() -> None:
    found = run([(60, EASY), (14, HARD), (46, EASY)])
    assert found and found.type == "longue"


def test_race_flag_wins() -> None:
    found = run([(40, HARD)], race=True)
    assert found and found.type == "course"


def test_without_stream_only_the_average_is_used() -> None:
    low = classify_workout(WorkoutInput(duration_s=3000, hr_avg=140), FC_MAX)
    high = classify_workout(WorkoutInput(duration_s=3000, hr_avg=175), FC_MAX)
    assert low and low.type == "footing" and low.confidence == "faible"
    assert high and high.type == "seuil" and high.confidence == "faible"
    assert classify_workout(WorkoutInput(duration_s=3000), FC_MAX) is None


def test_gaps_in_the_stream_do_not_count_as_effort() -> None:
    t, hr = profile([(20, EASY)])
    t.extend([float(1200 + 600), float(1200 + 601)])  # pause de 10 min
    hr.extend([HARD, HARD])
    found = classify_workout(WorkoutInput(duration_s=2000, hr_avg=140, t=t, hr=hr), FC_MAX)
    assert found and found.type == "footing"


def test_conformity_planned_threshold() -> None:
    threshold = run([(15, EASY), (25, HARD), (10, EASY)])
    easy = run([(50, EASY)])
    assert threshold and easy
    assert conformity("seuil", 40, threshold, 50) == (
        "atteint",
        "Séance de type « Seuil » comme prévu.",
    )
    verdict = conformity("seuil", 60, threshold, 50)
    assert verdict and verdict[0] == "partiel"  # 25 min d'effort pour au moins 30 attendues
    verdict = conformity("seuil", 40, easy, 50)
    assert verdict and verdict[0] == "ecart" and "sous le seuil" in verdict[1]


def test_conformity_planned_easy() -> None:
    threshold = run([(15, EASY), (25, HARD), (10, EASY)])
    easy = run([(50, EASY)])
    assert threshold and easy
    verdict = conformity("footing", 50, threshold, 50)
    assert verdict and verdict[0] == "ecart"
    verdict = conformity("footing", 50, easy, 50)
    assert verdict and verdict[0] == "atteint"
    long_run = run([(100, EASY)])
    assert long_run
    verdict = conformity("longue", 150, long_run, 100)
    assert verdict and verdict[0] == "partiel"


def test_conformity_ignores_other_types() -> None:
    easy = run([(50, EASY)])
    assert easy
    assert conformity("renfo", 40, easy, 50) is None
    assert conformity("repos", None, easy, 50) is None
    assert conformity("course", None, easy, 50) is None
    assert conformity("footing", 50, manual_workout("course"), 50) is None


# --- API ------------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(Settings(database_path=str(tmp_path / "w.db"), scheduler_enabled=False))
    app.state.today = lambda: TODAY
    with TestClient(app) as c:
        yield c


def add_run(client: TestClient, ext: str, start: datetime, segments: list[tuple[int, int]]) -> int:
    t, hr = profile(segments)
    with client.app.state.session_factory() as s:  # type: ignore[attr-defined]
        act = Activity(
            source="garmin",
            external_id=ext,
            sport="trail_running",
            start_utc=start,
            duration_s=len(t),
            distance_m=9000,
        )
        s.add(act)
        s.flush()
        s.add(ActivityStream(activity_id=act.id, samples=encode_stream({"t": t, "fc": hr})))
        assign_dedup_groups(s)
        s.commit()
        return act.id


def plan(client: TestClient, day: str, type_: str, minutes: int) -> int:
    body = {"date": day, "titre": "Séance", "type": type_, "duree_min": minutes}
    response = client.post("/api/plan/sessions", json=body)
    assert response.status_code == 201
    return int(response.json()["id"])


def day_sessions(client: TestClient, day: str) -> list[dict]:  # type: ignore[type-arg]
    week = client.get("/api/plan/week", params={"date": day}).json()
    return next(d for d in week["days"] if d["date"] == day)["sessions"]


def test_week_shows_detected_type_and_conformity(client: TestClient) -> None:
    add_run(client, "a", datetime(2026, 10, 13, 6), [(50, EASY)])
    plan(client, "2026-10-13", "seuil", 40)
    [session] = day_sessions(client, "2026-10-13")
    assert session["status"] == "fait"
    assert session["activity"]["workout"]["type"] == "footing"
    assert session["activity"]["workout"]["source"] == "calcul"
    assert session["conformity"] == "ecart"
    assert "séance facile" in session["conformity_reason"]


def test_manual_type_overrides_the_computed_one(client: TestClient) -> None:
    aid = add_run(client, "a", datetime(2026, 10, 13, 6), [(50, EASY)])
    plan(client, "2026-10-13", "seuil", 40)

    assert (
        client.put(f"/api/plan/activities/{aid}/workout-type", json={"type": "seuil"}).status_code
        == 204
    )
    [session] = day_sessions(client, "2026-10-13")
    assert session["activity"]["workout"] == {
        **session["activity"]["workout"],
        "type": "seuil",
        "source": "manuel",
    }
    assert session["conformity"] in {"atteint", "partiel"}

    assert (
        client.put(f"/api/plan/activities/{aid}/workout-type", json={"type": None}).status_code
        == 204
    )
    [session] = day_sessions(client, "2026-10-13")
    assert session["activity"]["workout"]["source"] == "calcul"


def test_workout_type_validation(client: TestClient) -> None:
    assert (
        client.put("/api/plan/activities/999/workout-type", json={"type": "seuil"}).status_code
        == 404
    )
    aid = add_run(client, "a", datetime(2026, 10, 13, 6), [(50, EASY)])
    assert (
        client.put(f"/api/plan/activities/{aid}/workout-type", json={"type": "repos"}).status_code
        == 422
    )
    assert (
        client.put(f"/api/plan/activities/{aid}/workout-type", json={"truc": 1}).status_code == 422
    )


def test_unplanned_run_gets_a_type_too(client: TestClient) -> None:
    add_run(client, "a", datetime(2026, 10, 14, 6), [(15, EASY), (25, HARD), (10, EASY)])
    week = client.get("/api/plan/week", params={"date": "2026-10-14"}).json()
    day = next(d for d in week["days"] if d["date"] == "2026-10-14")
    assert day["unplanned_activities"][0]["workout"]["type"] == "seuil"
