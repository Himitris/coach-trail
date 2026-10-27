import threading
from datetime import date, datetime
from typing import Any

from app.sync.types import (
    HealthResult,
    NormalizedActivity,
    NormalizedStream,
    NormalizedWellness,
    RawRecord,
    SourceNormalizer,
)


def activity_payload(
    ext_id: str, start: str = "2026-10-01T06:00:00+00:00", duration: float = 3600, **extra: Any
) -> dict[str, Any]:
    return {
        "id": ext_id,
        "sport": "trail_running",
        "start": start,
        "duration": duration,
        "distance": 10000,
        "gain": 400,
        "loss": 390,
        "hr_avg": 140,
        "hr_max": 170,
        "calories": 700,
        **extra,
    }


def wellness_payload(day: str, hrv: float = 62.0) -> dict[str, Any]:
    return {"date": day, "hrv": hrv, "rhr": 48, "sleep_s": 27000}


def stream_payload(n: int = 5) -> dict[str, Any]:
    return {
        "t": list(range(n)),
        "fc": [120 + i for i in range(n)],
        "alt": [300.0 + i for i in range(n)],
    }


class FakeConnector:
    """Connecteur de test : données de fixture, panne et blocage commandables."""

    def __init__(
        self,
        name: str = "garmin",
        activities: list[dict[str, Any]] | None = None,
        wellness: list[dict[str, Any]] | None = None,
        streams: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.name = name
        self.activities = activities or []
        self.wellness = wellness or []
        self.streams = streams or {}
        self.fail: Exception | None = None
        self.gate: threading.Event | None = None
        self.calls = {"activities": 0, "streams": 0, "wellness": 0}

    def _maybe_fail(self) -> None:
        if self.gate is not None:
            self.gate.wait(5)
        if self.fail is not None:
            raise self.fail

    def fetch_activities(self, since: datetime | None) -> list[RawRecord]:
        self.calls["activities"] += 1
        self._maybe_fail()
        return [RawRecord(a["id"], a) for a in self.activities]

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None:
        self.calls["streams"] += 1
        data = self.streams.get(external_id)
        return RawRecord(external_id, data) if data else None

    def fetch_wellness(self, since: date | None) -> list[RawRecord]:
        self.calls["wellness"] += 1
        return [RawRecord(w["date"], w) for w in self.wellness]

    def healthcheck(self) -> HealthResult:
        return HealthResult(ok=True)


def _activity(p: dict[str, Any]) -> NormalizedActivity:
    return NormalizedActivity(
        external_id=p["id"],
        sport=p["sport"],
        start=datetime.fromisoformat(p["start"]),
        duration_s=p["duration"],
        distance_m=p.get("distance"),
        elevation_gain_m=p.get("gain"),
        elevation_loss_m=p.get("loss"),
        hr_avg=p.get("hr_avg"),
        hr_max=p.get("hr_max"),
        calories=p.get("calories"),
    )


def _stream(p: dict[str, Any]) -> NormalizedStream:
    return NormalizedStream({"t": p["t"], "fc": p["fc"], "altitude": p["alt"]})


def _wellness(p: dict[str, Any]) -> NormalizedWellness:
    return NormalizedWellness(
        date=date.fromisoformat(p["date"]),
        hrv_nuit=p["hrv"],
        fc_repos=p["rhr"],
        sommeil_duree_s=p["sleep_s"],
    )


FAKE_NORMALIZER = SourceNormalizer(activity=_activity, stream=_stream, wellness=_wellness)
