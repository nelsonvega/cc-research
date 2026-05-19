"""Non-streaming JSON-array call used by suggestion endpoints.

Both Anthropic and OpenRouter are supported, routed by model id the same way
the streaming research path is. Returns (items, error) — items is a list on
success, [] on failure, and error is a human-readable string on failure.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import re

import httpx

from ..config import provider_for_model, settings
from .anthropic import ANTHROPIC_URL, ANTHROPIC_VERSION
from .openrouter import OPENROUTER_URL


async def call_json_array(
    *,
    prompt: str,
    model: str,
    max_tokens: int = 1000,
    timeout_s: float = 30.0,
) -> tuple[list[Any], str | None]:
    provider = provider_for_model(model)
    if provider == "anthropic":
        return await _anthropic_json_array(prompt, model, max_tokens, timeout_s)
    return await _openrouter_json_array(prompt, model, max_tokens, timeout_s)


async def _anthropic_json_array(
    prompt: str, model: str, max_tokens: int, timeout_s: float
) -> tuple[list[Any], str | None]:
    if not settings.anthropic_api_key:
        return [], "ANTHROPIC_API_KEY is not set on the server"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropic_api_key.get_secret_value(),
        "anthropic-version": ANTHROPIC_VERSION,
    }
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s)) as client:
            resp = await client.post(ANTHROPIC_URL, json=body, headers=headers)
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        return [], f"Network error: {type(e).__name__}: {e}"
    if resp.status_code >= 400:
        return [], f"Anthropic HTTP {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    text = "\n".join(b.get("text", "") for b in (data.get("content") or []) if b.get("type") == "text")
    return _parse_array(text)


async def _openrouter_json_array(
    prompt: str, model: str, max_tokens: int, timeout_s: float
) -> tuple[list[Any], str | None]:
    if not settings.openrouter_api_key:
        return [], "OPENROUTER_API_KEY is not set on the server"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.openrouter_api_key.get_secret_value()}",
        "HTTP-Referer": "https://github.com/local/cc-research",
        "X-Title": "cc-research",
    }
    body = {
        "model": model,  # no :online — suggestions don't need web search
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s)) as client:
            resp = await client.post(OPENROUTER_URL, json=body, headers=headers)
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        return [], f"Network error: {type(e).__name__}: {e}"
    if resp.status_code >= 400:
        return [], f"OpenRouter HTTP {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return [], "Malformed OpenRouter response (no message content)"
    return _parse_array(text)


def _parse_array(text: str) -> tuple[list[Any], str | None]:
    """Permissive JSON-array extractor.

    Accepts arrays of strings OR objects (or a mix). Strips code fences and
    grabs the substring between the first '[' and last ']'.
    """
    if not text:
        return [], "Empty response from model"
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return [], f"Response did not contain a JSON array (got {len(text)} chars)"
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as e:
        return [], f"JSON parse failed: {e}"
    if not isinstance(parsed, list):
        return [], "Response was not a JSON array"
    return parsed, None
