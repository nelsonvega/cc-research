from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        extra="ignore",
    )

    anthropic_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None

    cc_research_data_dir: Path = Path("data")
    cc_research_max_concurrent_topics: int = 3
    cc_research_host: str = "127.0.0.1"
    cc_research_port: int = 8000

    @property
    def runs_dir(self) -> Path:
        return self.cc_research_data_dir / "runs"


MODE_DEFAULTS: dict[str, str] = {
    "instant": "claude-haiku-4-5",
    "fast": "claude-sonnet-4-6",
    "thorough": "claude-sonnet-4-6",
    "deep": "claude-opus-4-7",
}

MODE_MAX_TOKENS: dict[str, int] = {
    "instant": 1000,
    "fast": 1500,
    "thorough": 2000,
    "deep": 4000,
}

MODE_TIMEOUT_S: dict[str, float] = {
    "instant": 15.0,
    "fast": 30.0,
    "thorough": 60.0,
    "deep": 240.0,
}


ANTHROPIC_STATIC_MODELS: list[dict] = [
    {"id": "claude-opus-4-7", "label": "Claude Opus 4.7", "provider": "anthropic", "supports_web_search": True},
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6", "provider": "anthropic", "supports_web_search": True},
    {"id": "claude-haiku-4-5", "label": "Claude Haiku 4.5", "provider": "anthropic", "supports_web_search": True},
]


def provider_for_model(model_id: str) -> str:
    """Route models to providers. Claude prefix → anthropic; everything else → openrouter."""
    return "anthropic" if model_id.startswith("claude-") else "openrouter"


settings = Settings()
