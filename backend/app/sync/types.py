from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Protocol

RAW_ACTIVITY = "activity"
RAW_STREAM = "activity_stream"
RAW_WELLNESS = "wellness"
RAW_PROFILE = "profile"

# États d'une source (source_status.state)
STATE_OK = "ok"
STATE_DEGRADED = "degraded"
STATE_AUTH_REQUIRED = "auth_required"
STATE_DOWN = "down"


class SourceError(Exception):
    """Échec d'une source avec un état et un message lisible (en français)."""

    def __init__(self, state: str, message: str) -> None:
        super().__init__(message)
        self.state = state
        self.user_message = message


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

    def fetch_activities(self, since: datetime | None) -> Iterable[RawRecord]: ...

    def fetch_activity_stream(self, external_id: str) -> RawRecord | None: ...

    def fetch_wellness(self, since: date | None) -> Iterable[RawRecord]: ...

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
    is_race: bool = False


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
class NormalizedProfile:
    """Valeurs de profil fournies par la source (appliquées à athlete_profile si présentes)."""

    fc_repos: int | None = None
    seuil_lactique_fc: int | None = None
    zones: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class SourceNormalizer:
    """Fonctions normalize_* d'une source : payload brut -> données normalisées (None = ignoré)."""

    activity: Callable[[dict[str, Any]], NormalizedActivity | None]
    stream: Callable[[dict[str, Any]], NormalizedStream | None]
    wellness: Callable[[dict[str, Any]], NormalizedWellness | None]
    profile: Callable[[dict[str, Any]], NormalizedProfile | None] | None = None
