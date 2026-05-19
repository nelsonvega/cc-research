"""Live model catalog from OpenRouter.

GET https://openrouter.ai/api/v1/models returns the full list of models with
metadata. The endpoint is public (no auth required) but we still send the key
if configured so OpenRouter can scope to the user's enabled providers.

Cached in-process for CATALOG_TTL_S to avoid hammering on every /api/models
hit. The cache is best-effort — failures fall back to last-known-good (if any)
and otherwise return an empty list so the UI can still render Anthropic models.
"""
from __future__ import annotations

import asyncio
import time

import httpx

from ..config import settings
from ..models import ModelInfo

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CATALOG_TTL_S = 3600.0

_cache: dict[str, object] = {
    "fetched_at": 0.0,
    "models": [],  # list[ModelInfo]
    "error": None,
}
_lock = asyncio.Lock()


def _to_model_info(raw: dict) -> ModelInfo | None:
    model_id = raw.get("id")
    if not model_id:
        return None
    name = raw.get("name") or model_id
    pricing = raw.get("pricing") or {}

    def _price_per_million(key: str) -> float | None:
        v = pricing.get(key)
        if v in (None, "", "0"):
            return None
        try:
            return float(v) * 1_000_000
        except (TypeError, ValueError):
            return None

    # Some models report "0" pricing (free) — keep them as None so the UI
    # doesn't show "$0/M" which could mislead users about free vs unknown.
    return ModelInfo(
        id=model_id,
        label=name,
        provider="openrouter",
        supports_web_search=True,  # all via :online plugin
        context_length=raw.get("context_length") or None,
        prompt_price=_price_per_million("prompt"),
        completion_price=_price_per_million("completion"),
        description=raw.get("description") or None,
    )


async def fetch_models(force: bool = False) -> tuple[list[ModelInfo], str | None]:
    """Return (models, error). Models is empty list on first-fetch failure."""
    now = time.monotonic()
    cached_models: list[ModelInfo] = _cache["models"]  # type: ignore[assignment]
    fetched_at: float = _cache["fetched_at"]  # type: ignore[assignment]
    if not force and cached_models and (now - fetched_at) < CATALOG_TTL_S:
        return cached_models, None

    async with _lock:
        # Double-check after acquiring the lock — another coroutine may have
        # populated the cache while we were waiting.
        now = time.monotonic()
        cached_models = _cache["models"]  # type: ignore[assignment]
        fetched_at = _cache["fetched_at"]  # type: ignore[assignment]
        if not force and cached_models and (now - fetched_at) < CATALOG_TTL_S:
            return cached_models, None

        headers = {"Accept": "application/json"}
        if settings.openrouter_api_key:
            headers["Authorization"] = f"Bearer {settings.openrouter_api_key.get_secret_value()}"

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
                resp = await client.get(OPENROUTER_MODELS_URL, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            err = f"OpenRouter catalog fetch failed: {type(e).__name__}: {e}"
            _cache["error"] = err
            # Fall back to last-known-good if we have anything.
            return cached_models, err

        raw_list = (data.get("data") or []) if isinstance(data, dict) else []
        models: list[ModelInfo] = []
        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            m = _to_model_info(raw)
            if m is not None:
                models.append(m)
        # Sort by label for predictable order in the UI.
        models.sort(key=lambda m: m.label.lower())

        _cache["models"] = models
        _cache["fetched_at"] = time.monotonic()
        _cache["error"] = None
        return models, None
