"""Runtime settings, loaded from environment (see .env.example)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gcp_project: str = "shafay-nutrition"
    bq_dataset: str = "nutrition"
    workout_sheet_id: str = ""

    gemini_api_key: str = ""
    chomp_api_key: str = ""
    gemini_model_fast: str = "gemini-flash-lite-latest"
    gemini_model_smart: str = "gemini-flash-latest"

    dev_no_auth: bool = False
    use_stubs: bool = False
    cors_origins: str = "http://localhost:4200"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
