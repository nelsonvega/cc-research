from fastapi import APIRouter

from ..config import ANTHROPIC_STATIC_MODELS, MODE_DEFAULTS, settings
from ..models import ModelInfo
from ..providers.openrouter_catalog import fetch_models as fetch_openrouter_models

router = APIRouter()


@router.get("/api/models")
async def list_models() -> dict:
    anthropic_models: list[ModelInfo] = []
    if settings.anthropic_api_key:
        anthropic_models = [ModelInfo.model_validate(m) for m in ANTHROPIC_STATIC_MODELS]

    openrouter_models: list[ModelInfo] = []
    openrouter_error: str | None = None
    if settings.openrouter_api_key:
        openrouter_models, openrouter_error = await fetch_openrouter_models()

    return {
        "models": [m.model_dump() for m in anthropic_models + openrouter_models],
        "mode_defaults": MODE_DEFAULTS,
        "providers_configured": {
            "anthropic": bool(settings.anthropic_api_key),
            "openrouter": bool(settings.openrouter_api_key),
        },
        "openrouter_catalog_error": openrouter_error,
    }
