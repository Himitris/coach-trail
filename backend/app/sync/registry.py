from collections.abc import Mapping
from typing import cast

from app.config import Settings
from app.garmin.auth import build_api
from app.garmin.connector import GarminAPI, GarminConnector
from app.garmin.normalize import GARMIN_NORMALIZER
from app.intervals.connector import IntervalsConnector
from app.intervals.normalize import INTERVALS_NORMALIZER
from app.sync.types import SourceConnector, SourceNormalizer


def build_sources(
    settings: Settings,
) -> tuple[Mapping[str, SourceConnector], Mapping[str, SourceNormalizer]]:
    """Connecteurs et normaliseurs actifs. Intervals.icu n'est actif que s'il est configuré."""

    def api_factory() -> GarminAPI:
        return cast(GarminAPI, build_api(settings.garmin_token_dir))

    garmin = GarminConnector(
        api_factory,
        history_months=settings.garmin_history_months,
        min_delay_s=settings.garmin_min_delay_s,
        max_delay_s=settings.garmin_max_delay_s,
        stream_max_points=settings.garmin_stream_max_points,
    )
    connectors: dict[str, SourceConnector] = {"garmin": garmin}
    normalizers: dict[str, SourceNormalizer] = {"garmin": GARMIN_NORMALIZER}
    api_key = settings.intervals_api_key.get_secret_value()
    if settings.intervals_athlete_id and api_key:
        connectors["intervals"] = IntervalsConnector(
            settings.intervals_athlete_id,
            api_key,
            history_months=settings.intervals_history_months,
        )
        normalizers["intervals"] = INTERVALS_NORMALIZER
    return connectors, normalizers
