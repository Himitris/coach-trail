"""Activités détectées par la montre : synchronisation, filtrage, intégration au programme."""

from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.main import create_app
from app.metrics.volume import ActivityRow
from app.models import RawPayload
from app.plan.movement import MIN_MOVE_MIN, detected_movements
from app.sync.types import RAW_EVENTS


def event(start_gmt: str, minutes: int, kind: str = "walking") -> dict[str, Any]:
    day, hhmm = start_gmt.split("T")
    hour = int(hhmm[:2]) + 1  # heure locale = GMT + 1
    return {
        "startTimestampGMT": f"{start_gmt}:00.0",
        "endTimestampGMT": f"{start_gmt}:00.0",
        "startTimestampLocal": f"{day}T{hour:02d}:{hhmm[3:5]}:00.0",
        "duration": minutes,
        "activityType": kind,
    }


def store(session: Session, day: str, events: list[dict[str, Any]]) -> None:
    session.add(
        RawPayload(
            source="garmin", type=RAW_EVENTS, external_key=day, fetched_at=datetime(2026, 11, 3),
            payload={"events": events}, hash=day,
        )
    )  # fmt: skip
    session.commit()


def test_keeps_long_unrecorded_movements_only(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=str(tmp_path / "m.db"), scheduler_enabled=False))
    with TestClient(app), app.state.session_factory() as session:
        walk = event("2026-10-31T07:47", 26)
        short = event("2026-10-31T12:00", MIN_MOVE_MIN - 5)
        recorded_run = event("2026-10-31T16:00", 40, "running")
        store(session, "2026-10-31", [walk, short, recorded_run])
        run_row = ActivityRow(
            id=1, day=date(2026, 10, 31), start_utc=datetime(2026, 10, 31, 16, 1),
            sport="running", duration_s=39 * 60,
        )  # fmt: skip
        found = detected_movements(session, date(2026, 10, 27), date(2026, 11, 2), [run_row])
    items = found[date(2026, 10, 31)]
    assert [(m.label, m.duration_min, m.start) for m in items] == [("Marche", 26, "08:47")]
