from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Protocol

RAW_ACTIVITY = "activity"
RAW_STREAM = "activity_stream"
RAW_WELLNESS = "wellness"


@dataclass(frozen=True)
class RawRecord:
    """Payload brut renvoyé par un connecteur ; `key` = identifiant externe stable."""

    key: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class HealthResult:
    ok: bool
    message: str = ""


class SourceConnector(Protocol):
    name: str

    def fetch_activities(self, since: datetime | None) -> list[RawRecord]: ...

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None: ...

    def fetch_wellness(self, since: date | None) -> list[RawRecord]: ...

    def healthcheck(self) -> HealthResult: ...


@dataclass(frozen=True)
class NormalizedActivity:
    external_id: str
    sport: str
    start: datetime  # aware ou UTC naïf
    duration_s: float
    distance_m: float | None = None
    elevation_gain_m: float | None = None
    elevation_loss_m: float | None = None
    hr_avg: int | None = None
    hr_max: int | None = None
    calories: int | None = None
    gear: str | None = None


@dataclass(frozen=True)
class NormalizedStream:
    """Colonnes d'échantillons de même longueur : t, fc, altitude, speed, distance, cadence."""

    samples: dict[str, list[float | None]] = field(default_factory=dict)


@dataclass(frozen=True)
class NormalizedWellness:
    date: date
    hrv_nuit: float | None = None
    hrv_base_min: float | None = None
    hrv_base_max: float | None = None
    fc_repos: int | None = None
    sommeil_duree_s: int | None = None
    sommeil_efficacite: float | None = None
    stress: int | None = None
    spo2: float | None = None
    training_readiness: int | None = None
    body_battery_max: int | None = None
    body_battery_min: int | None = None
    poids_kg: float | None = None


@dataclass(frozen=True)
class SourceNormalizer:
    """Fonctions normalize_* d'une source : payload brut -> données normalisées (None = ignoré)."""

    activity: Callable[[dict[str, Any]], NormalizedActivity | None]
    stream: Callable[[dict[str, Any]], NormalizedStream | None]
    wellness: Callable[[dict[str, Any]], NormalizedWellness | None]
