import copy
import logging
from datetime import UTC, date, datetime
from typing import Any

import pytest

from app.garmin.normalize import GARMIN_NORMALIZER as N
from app.sync.types import NormalizedProfile
from tests.fake_garmin import fixture


def _profile(payload: dict[str, Any]) -> NormalizedProfile | None:
    assert N.profile is not None
    return N.profile(payload)


def activity_payload() -> dict[str, object]:
    return {"summary": fixture("activity_summary.json"), "detail": fixture("activity_detail.json")}


def wellness_payload() -> dict[str, object]:
    return {
        "date": "2026-10-04",
        "summary": fixture("user_summary.json"),
        "sleep": fixture("sleep.json"),
        "hrv": fixture("hrv.json"),
        "training_readiness": fixture("training_readiness.json"),
        "weight": fixture("weigh_ins.json"),
    }


def test_activity() -> None:
    a = N.activity(activity_payload())
    assert a is not None
    assert a.external_id == "17000000001"
    assert a.sport == "trail_running"
    assert a.start == datetime(2026, 10, 4, 6, 5, 12, tzinfo=UTC)
    assert a.duration_s == pytest.approx(5421.3)
    assert a.distance_m == pytest.approx(12840.5)
    assert (a.elevation_gain_m, a.elevation_loss_m) == (512.0, 498.0)
    assert (a.hr_avg, a.hr_max, a.calories) == (147, 178, 905)


def test_activity_falls_back_to_detail_summary(caplog: pytest.LogCaptureFixture) -> None:
    payload = activity_payload()
    summary = payload["summary"]
    assert isinstance(summary, dict)
    for key in ("startTimeGMT", "duration", "distance", "activityType"):
        summary.pop(key)
    a = N.activity(payload)
    assert a is not None
    assert a.start == datetime(2026, 10, 4, 6, 5, 12, tzinfo=UTC)
    assert a.duration_s == pytest.approx(5421.3)
    assert a.sport == "trail_running"  # via detail.activityTypeDTO


def test_activity_without_detail() -> None:
    a = N.activity({"summary": fixture("activity_summary.json"), "detail": None})
    assert a is not None and a.hr_avg == 147


def test_activity_missing_essentials_is_none_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    payload = activity_payload()
    payload["summary"].pop("startTimeGMT")  # type: ignore[attr-defined]
    payload["detail"] = None
    with caplog.at_level(logging.WARNING):
        assert N.activity(payload) is None
    assert "champs essentiels" in caplog.text


@pytest.mark.parametrize("garbage", [{}, {"summary": 5}, {"summary": None, "detail": []}])
def test_garbage_never_raises(garbage: dict[str, object]) -> None:
    assert N.activity(garbage) is None
    assert N.wellness(garbage) is None
    assert N.stream(garbage) is None
    assert _profile(garbage) is None


def test_stream_maps_channels() -> None:
    from app.garmin.connector import GarminConnector
    from tests.fake_garmin import FakeGarminAPI

    api = FakeGarminAPI()
    conn = GarminConnector(lambda: api, sleep=lambda _s: None)
    conn.healthcheck()
    rec = conn.fetch_activity_stream("17000000001")
    assert rec is not None
    # puissance (non retenue) absente du brut ; canaux utiles présents
    assert "directPower" not in rec.payload["columns"]
    s = N.stream(rec.payload)
    assert s is not None
    assert s.samples["t"] == [0, 1, 2, 3, 4, 5]
    assert s.samples["fc"] == [120, 123, 126, None, 132, 135]
    assert s.samples["altitude"][1] == pytest.approx(300.5)
    assert s.samples["cadence"][0] == 168
    assert set(s.samples) == {"t", "fc", "altitude", "speed", "distance", "cadence"}


def test_stream_time_from_timestamps_when_no_duration() -> None:
    payload = {"columns": {"directTimestamp": [1000, 2000, 4000], "directHeartRate": [1, 2, 3]}}
    s = N.stream(payload)
    assert s is not None and s.samples["t"] == [0, 1, 3]


def test_wellness_full() -> None:
    w = N.wellness(wellness_payload())
    assert w is not None
    assert w.date == date(2026, 10, 4)
    assert w.hrv_nuit == 62  # hrvSummary.lastNightAvg
    assert (w.hrv_base_min, w.hrv_base_max) == (54, 71)
    assert w.fc_repos == 48
    assert w.sommeil_duree_s == 27000
    assert w.sommeil_efficacite == 90.0  # 27000 s / fenêtre 30000 s
    assert w.stress == 29
    assert w.spo2 == 94.0
    assert w.training_readiness == 68  # relevé du réveil, pas la mise à jour de l'après-midi
    assert (w.body_battery_max, w.body_battery_min) == (92, 18)
    assert w.poids_kg == 71.8


def test_wellness_missing_parts_give_none(caplog: pytest.LogCaptureFixture) -> None:
    p = wellness_payload()
    p["sleep"] = {"unexpectedRenamedKey": 1}
    p["hrv"] = None
    p["training_readiness"] = []
    p["weight"] = None
    with caplog.at_level(logging.WARNING):
        w = N.wellness(p)
    assert w is not None
    assert w.sommeil_duree_s is None and w.hrv_nuit is None and w.training_readiness is None
    assert w.fc_repos == 48 and w.body_battery_max == 92  # le reste est conservé
    assert "dailySleepDTO absent" in caplog.text


def test_wellness_negative_stress_and_empty() -> None:
    p = wellness_payload()
    p["summary"]["averageStressLevel"] = -1  # type: ignore[index]
    w = N.wellness(p)
    assert w is not None and w.stress is None
    empty = {"date": "2026-10-04", "summary": None, "sleep": None, "hrv": None}
    assert N.wellness(empty) is None
    assert N.wellness({"date": "pas-une-date"}) is None


def test_hrv_falls_back_to_sleep_value() -> None:
    p = wellness_payload()
    p["hrv"] = None
    w = N.wellness(p)
    assert w is not None and w.hrv_nuit == 61.0 and w.hrv_base_min is None


def test_profile_prefers_running_zones() -> None:
    payload = {
        "heart_rate_zones": fixture("heart_rate_zones.json"),
        "lactate_threshold": fixture("lactate_threshold.json"),
    }
    prof = _profile(payload)
    assert prof is not None
    assert prof.fc_repos == 47
    assert prof.seuil_lactique_fc == 173  # mesure Garmin prioritaire sur lactateThresholdHrUsed
    assert prof.zones is not None
    assert [z["min_bpm"] for z in prof.zones] == [100, 120, 139, 158, 177]
    assert prof.zones[-1]["max_bpm"] == 195 and prof.zones[0]["min_pct"] == 51


def test_profile_bad_zones_are_ignored() -> None:
    payload = copy.deepcopy({"heart_rate_zones": [{"sport": "DEFAULT", "zone1Floor": 98}]})
    prof = _profile(payload)
    assert prof is None
