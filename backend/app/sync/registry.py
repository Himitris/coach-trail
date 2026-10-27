from collections.abc import Mapping
from typing import cast

from app.config import Settings
from app.garmin.auth import build_api
from app.garmin.connector import GarminAPI, GarminConnector
from app.garmin.normalize import GARMIN_NORMALIZER
from app.sync.types import SourceConnector, SourceNormalizer


def build_sources(
    settings: Settings,
) -> tuple[Mapping[str, SourceConnector], Mapping[str, SourceNormalizer]]:
    """Connecteurs et normaliseurs actifs. Intervals.icu et Strava arrivent plus tard."""

    def api_factory() -> GarminAPI:
        return cast(GarminAPI, build_api(settings.garmin_token_dir))

    garmin = GarminConnector(
        api_factory,
        history_months=settings.garmin_history_months,
        min_delay_s=settings.garmin_min_delay_s,
        max_delay_s=settings.garmin_max_delay_s,
        stream_max_points=settings.garmin_stream_max_points,
    )
    return {"garmin": garmin}, {"garmin": GARMIN_NORMALIZER}
