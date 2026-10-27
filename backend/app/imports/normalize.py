"""Normalisation de la source « import » (reconstructible depuis raw_payload comme les autres)."""

import logging
from typing import Any

from app.intervals.normalize import _int, _num, _parse_utc, _safe, _stream
from app.sync.types import NormalizedActivity, NormalizedWellness, SourceNormalizer

logger = logging.getLogger(__name__)
SOURCE = "import"


def _activity(payload: dict[str, Any]) -> NormalizedActivity | None:
    ext_id = payload.get("id")
    start = _parse_utc(payload.get("start"))
    duration = _num(payload.get("duration_s"))
    if ext_id is None or start is None or not duration:
        return None
    return NormalizedActivity(
        external_id=str(ext_id),
        sport=str(payload.get("sport") or "unknown"),
        start=start,
        duration_s=duration,
        distance_m=_num(payload.get("distance_m")),
        elevation_gain_m=_num(payload.get("gain_m")),
        elevation_loss_m=_num(payload.get("loss_m")),
        hr_avg=_int(payload.get("hr_avg")),
        hr_max=_int(payload.get("hr_max")),
        calories=_int(payload.get("calories")),
    )


def _no_wellness(_: dict[str, Any]) -> NormalizedWellness | None:
    return None


IMPORT_NORMALIZER = SourceNormalizer(
    activity=_safe("activité", _activity),
    stream=_safe("flux", _stream),
    wellness=_no_wellness,
)
