"""Faux client Garmin alimenté par les fixtures JSON : aucun accès réseau."""

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parent / "fixtures" / "garmin"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


class FakeHTTPError(Exception):
    """Erreur HTTP type requests : porte `response.status_code`."""

    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP {status}")
        self.response = type("R", (), {"status_code": status})()


class FakeGarminAPI:
    def __init__(self) -> None:
        self.raises: dict[str, Exception] = {}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.activity_ids = ["17000000001"]

    def _do(self, name: str, args: tuple[Any, ...], value: Any) -> Any:
        self.calls.append((name, args))
        if name in self.raises:
            raise self.raises[name]
        return value

    def called(self, name: str) -> list[tuple[Any, ...]]:
        return [a for n, a in self.calls if n == name]

    def get_activities_by_date(
        self, startdate: str, enddate: str | None = None, sortorder: str | None = None
    ) -> list[dict[str, Any]]:
        out = []
        for aid in self.activity_ids:
            s = fixture("activity_summary.json")
            s["activityId"] = int(aid)
            out.append(s)
        return self._do(  # type: ignore[no-any-return]
            "get_activities_by_date", (startdate, enddate, sortorder), out
        )

    def get_activity(self, activity_id: str) -> dict[str, Any]:
        d = fixture("activity_detail.json")
        d["activityId"] = int(activity_id)
        return self._do("get_activity", (activity_id,), d)  # type: ignore[no-any-return]

    def get_activity_details(
        self, activity_id: str, maxchart: int = 2000, maxpoly: int = 4000
    ) -> dict[str, Any]:
        return self._do(  # type: ignore[no-any-return]
            "get_activity_details",
            (activity_id, maxchart, maxpoly),
            fixture("activity_details.json"),
        )

    def get_user_summary(self, cdate: str) -> dict[str, Any]:
        return self._do("get_user_summary", (cdate,), fixture("user_summary.json"))  # type: ignore[no-any-return]

    def get_sleep_data(self, cdate: str) -> dict[str, Any]:
        return self._do("get_sleep_data", (cdate,), fixture("sleep.json"))  # type: ignore[no-any-return]

    def get_hrv_data(self, cdate: str) -> dict[str, Any] | None:
        return self._do("get_hrv_data", (cdate,), fixture("hrv.json"))  # type: ignore[no-any-return]

    def get_training_readiness(self, cdate: str) -> Any:
        return self._do("get_training_readiness", (cdate,), fixture("training_readiness.json"))

    def get_training_status(self, cdate: str) -> dict[str, Any]:
        return self._do("get_training_status", (cdate,), fixture("training_status.json"))  # type: ignore[no-any-return]

    def get_race_predictions(self) -> dict[str, Any]:
        return self._do("get_race_predictions", (), fixture("race_predictions.json"))  # type: ignore[no-any-return]

    def get_weigh_ins(self, startdate: str, enddate: str) -> dict[str, Any]:
        return self._do("get_weigh_ins", (startdate, enddate), fixture("weigh_ins.json"))  # type: ignore[no-any-return]

    def get_heart_rate_zones(self) -> list[dict[str, Any]]:
        return self._do("get_heart_rate_zones", (), fixture("heart_rate_zones.json"))  # type: ignore[no-any-return]

    def get_lactate_threshold(self, *, latest: bool = True) -> dict[str, Any]:
        return self._do("get_lactate_threshold", (), fixture("lactate_threshold.json"))  # type: ignore[no-any-return]
