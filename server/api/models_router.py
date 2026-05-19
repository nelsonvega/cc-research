from fastapi import APIRouter

from ..config import MODE_DEFAULTS, SUPPORTED_MODELS, settings
from ..models import ModelInfo

router = APIRouter()


@router.get("/api/models")
def list_models() -> dict:
    available = [
        ModelInfo.model_validate(m)
        for m in SUPPORTED_MODELS
        if (m["provider"] == "anthropic" and settings.anthropic_api_key)
        or (m["provider"] == "openrouter" and settings.openrouter_api_key)
    ]
    return {
        "models": [m.model_dump() for m in available],
        "mode_defaults": MODE_DEFAULTS,
        "providers_configured": {
            "anthropic": bool(settings.anthropic_api_key),
            "openrouter": bool(settings.openrouter_api_key),
        },
    }
