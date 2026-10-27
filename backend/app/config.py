from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration lue dans l'environnement (voir .env.example)."""

    model_config = SettingsConfigDict(extra="ignore")

    tz: str = "Europe/Paris"
    database_path: str = "/data/coach.db"
    backup_dir: str = "/backup"
    garmin_token_dir: str = "/data/garmin_tokens"  # noqa: S105
    intervals_athlete_id: str = ""
    intervals_api_key: SecretStr = SecretStr("")
    strava_client_id: str = ""
    strava_client_secret: SecretStr = SecretStr("")

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path}"

    def secret_values(self) -> list[str]:
        """Valeurs sensibles à masquer dans les logs."""
        values = [self.intervals_api_key, self.strava_client_secret]
        return [v.get_secret_value() for v in values if v.get_secret_value()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
