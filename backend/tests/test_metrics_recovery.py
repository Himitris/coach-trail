import math
from collections.abc import Sequence
from datetime import date, timedelta

import pytest

from app.metrics.models import Evidence
from app.metrics.recovery import (
    PROPRIETARY_LABEL,
    baseline_comparison,
    find_key,
    garmin_acwr,
    proprietary_metric,
)

END = date(2026, 10, 15)
EV = Evidence(level="indicatif", summary="test")


def make_series(
    baseline: Sequence[float | None], recent: Sequence[float | None], baseline_days: int = 60
) -> dict[date, float | None]:
    """Fenêtre récente = 7 derniers jours ; base = `baseline_days` jours juste avant."""
    series: dict[date, float | None] = {}
    first_recent = END - timedelta(days=6)
    for i, v in enumerate(recent):
        series[first_recent + timedelta(days=i)] = v
    for i, v in enumerate(baseline):
        series[first_recent - timedelta(days=baseline_days - i)] = v
    return series


ALTERNATING = [58.0 if i % 2 == 0 else 62.0 for i in range(60)]  # moyenne 60, écart-type de 2,017


def test_hrv_hand_computed() -> None:
    s = make_series(ALTERNATING, [64.0] * 7)
    c = baseline_comparison(s, END, evidence=EV)
    assert c.recent_mean == 64 and c.recent_n == 7
    assert c.baseline_mean == 60 and c.baseline_n == 60
    # variance échantillon = 60 × 4 / 59 = 4,0678 -> écart-type 2,01687
    assert c.baseline_sd == pytest.approx(math.sqrt(240 / 59))
    assert c.delta == 4 and c.delta_pct == pytest.approx(4 / 60 * 100)
    assert c.delta_sd == pytest.approx(4 / math.sqrt(240 / 59))
    assert c.sufficient and c.trend.direction == "hausse"
    assert c.evidence.summary == "test"


def test_small_change_is_stable_not_a_verdict() -> None:
    s = make_series(ALTERNATING, [60.5] * 7)  # 0,25 écart-type
    c = baseline_comparison(s, END, evidence=EV)
    assert c.delta_sd == pytest.approx(0.5 / math.sqrt(240 / 59))
    assert c.trend.direction == "stable"
    s = make_series(ALTERNATING, [56.0] * 7)
    assert baseline_comparison(s, END, evidence=EV).trend.direction == "baisse"


def test_baseline_length_is_clamped_to_30_60() -> None:
    s = make_series(ALTERNATING[:30], [64.0] * 7, baseline_days=30)
    c = baseline_comparison(s, END, baseline_days=10, evidence=EV)
    assert c.baseline_days == 30 and c.baseline_n == 30
    c = baseline_comparison(s, END, baseline_days=500, evidence=EV)
    assert c.baseline_days == 60 and c.baseline_n == 30  # même série : la fenêtre de 60 j s'étend


def test_insufficient_data_gives_no_trend() -> None:
    s = make_series(ALTERNATING, [64.0, 64.0, None, None, None, None, 64.0])  # 3 nuits sur 7
    c = baseline_comparison(s, END, evidence=EV)
    assert not c.sufficient
    assert c.trend.direction == "indetermine" and c.delta_sd is None
    assert c.recent_mean == 64  # la moyenne reste visible
    assert c.evidence.level == "indicatif" and "insuffisantes" in c.evidence.summary
    short_base = make_series(ALTERNATING[:10], [64.0] * 7, baseline_days=10)
    assert not baseline_comparison(short_base, END, evidence=EV).sufficient


def test_no_data_at_all() -> None:
    c = baseline_comparison({}, END, evidence=EV)
    assert c.recent_mean is None and c.baseline_mean is None and c.baseline_sd is None
    assert c.delta is None and c.delta_pct is None and not c.sufficient
    assert c.trend.direction == "indetermine"


def test_baseline_excludes_recent_week_and_future() -> None:
    s = make_series(ALTERNATING, [64.0] * 7)
    s[END + timedelta(days=3)] = 1000.0  # postérieur à la date demandée
    c = baseline_comparison(s, END, evidence=EV)
    assert c.recent_mean == 64 and c.baseline_mean == 60


def test_proprietary_metric_is_labelled_and_untouched() -> None:
    series: dict[date, float | None] = {END - timedelta(days=i): 60.0 for i in range(1, 8)}
    series[END] = 74.0
    m = proprietary_metric(series, END, "Training Readiness")
    assert m.date == END and m.value == 74.0
    assert m.previous_7d_mean == 60.0
    assert m.label == PROPRIETARY_LABEL == "avis Garmin, non validé"
    assert m.evidence.level == "avis_montre" and "non validé" in m.evidence.summary
    assert m.trend.direction == "hausse" and m.trend.delta == 14


def test_proprietary_metric_without_data_or_history() -> None:
    m = proprietary_metric({}, END, "Body Battery")
    assert m.value is None and m.date is None and m.trend.direction == "indetermine"
    only_today = proprietary_metric({END: 50.0}, END, "Body Battery")
    assert only_today.value == 50.0 and only_today.previous_7d_mean is None
    assert only_today.trend.direction == "indetermine"
    # valeur la plus récente <= date demandée
    m = proprietary_metric({END: 50.0, END + timedelta(days=2): 99.0}, END, "x")
    assert m.value == 50.0


def test_acwr_is_garmin_value_only_and_not_validated() -> None:
    status = {
        "mostRecentTrainingStatus": {
            "data": {
                "d1": {
                    "acuteTrainingLoadDTO": {
                        "dailyAcuteChronicWorkloadRatio": 1.35,
                        "acwrStatus": "HIGH",
                    }
                }
            }
        }
    }
    assert find_key(status, "dailyAcuteChronicWorkloadRatio") == 1.35
    acwr = garmin_acwr(status, END)
    assert acwr is not None and acwr.value == 1.35
    assert acwr.label == "non validé" and acwr.evidence.level == "non_valide"
    assert "aucune alerte" in acwr.evidence.summary
    assert garmin_acwr({"other": 1}, END) is None
    assert garmin_acwr(None, END) is None
    assert find_key([{"a": True}], "a") is None  # un booléen n'est pas une valeur
