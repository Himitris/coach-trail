import re
from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration lue dans l'environnement (voir .env.example)."""

    model_config = SettingsConfigDict(extra="ignore")

    tz: str = "Europe/Paris"
    database_path: str = "/data/coach.db"
    backup_dir: str = "/backup"
    backup_time: str = "04:30"
    garmin_token_dir: str = "/data/garmin_tokens"  # noqa: S105
    intervals_athlete_id: str = ""
    intervals_api_key: SecretStr = SecretStr("")
    strava_client_id: str = ""
    strava_client_secret: SecretStr = SecretStr("")
    # Strava est optionnel et désactivé par défaut (conditions de l'API : voir README).
    strava_enabled: bool = False
    strava_token_dir: str = "/data/strava_tokens"  # noqa: S105
    strava_redirect_uri: str = "https://coach.himitris.fr/api/strava/callback"
    strava_history_months: int = 12

    sync_time: str = "03:30"
    source_priority: str = "garmin,intervals,strava"
    sync_overlap_days: int = 3
    scheduler_enabled: bool = True
    garmin_history_months: int = 12
    intervals_history_months: int = 12
    garmin_min_delay_s: float = 1.0
    garmin_max_delay_s: float = 3.0
    garmin_stream_max_points: int = 20000

    # Serveur MCP (lecture seule, phase 3) : jeton partagé optionnel, désactivé par défaut
    mcp_token: SecretStr = SecretStr("")
    mcp_api_url: str = "http://127.0.0.1:8000"
    mcp_host: str = "127.0.0.1"
    mcp_port: int = 8765
    mcp_allowed_hosts: str = "localhost:*,127.0.0.1:*,coach.himitris.fr:*"

    @field_validator("sync_time", "backup_time")
    @classmethod
    def _check_sync_time(cls, v: str) -> str:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError("SYNC_TIME et BACKUP_TIME doivent être au format HH:MM")
        return v

    @property
    def sync_hour_minute(self) -> tuple[int, int]:
        h, m = self.sync_time.split(":")
        return int(h), int(m)

    @property
    def backup_hour_minute(self) -> tuple[int, int]:
        h, m = self.backup_time.split(":")
        return int(h), int(m)

    @property
    def priority_list(self) -> list[str]:
        return [s.strip() for s in self.source_priority.split(",") if s.strip()]

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path}"

    def secret_values(self) -> list[str]:
        """Valeurs sensibles à masquer dans les logs."""
        values = [self.intervals_api_key, self.strava_client_secret, self.mcp_token]
        return [v.get_secret_value() for v in values if v.get_secret_value()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
