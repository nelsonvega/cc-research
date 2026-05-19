"""OpenRouter streaming provider.

OpenAI-compatible /chat/completions with stream=true. Web search is enabled
by appending ":online" to the model id (OpenRouter's built-in web plugin)
unless the user already included it.
"""
from __future__ import annotations

import asyncio
import json
import random
import time
from typing import AsyncIterator

import httpx

from ..config import settings
from ..models import Event
from ..store import card_from_raw, extract_json_array
from .base import ProviderError

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


async def stream_research(
    *,
    topic: str,
    prompt: str,
    model: str,
    web_search: bool,
    max_tokens: int,
    timeout_s: float,
    cancel: asyncio.Event,
) -> AsyncIterator[Event]:
    if not settings.openrouter_api_key:
        raise ProviderError("OPENROUTER_API_KEY is not set")

    model_id = model
    if web_search and not model_id.endswith(":online"):
        model_id = f"{model_id}:online"

    body = {
        "model": model_id,
        "max_tokens": max_tokens,
        "stream": True,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.openrouter_api_key.get_secret_value()}",
        "HTTP-Referer": "https://github.com/local/cc-research",
        "X-Title": "cc-research",
    }

    yield Event(
        type="log", topic=topic,
        payload={"level": "info", "message": f"prompt built · {len(prompt)} chars"},
    )

    timeout = httpx.Timeout(timeout_s, connect=10.0, read=timeout_s, write=timeout_s)
    async with httpx.AsyncClient(timeout=timeout) as client:
        attempts = 0
        while True:
            attempts += 1
            if cancel.is_set():
                raise asyncio.CancelledError
            try:
                yield Event(
                    type="log", topic=topic,
                    payload={
                        "level": "info",
                        "message": (
                            f"POST /v1/chat/completions · model={model_id} · max_tokens={max_tokens}"
                            f" · web_search={'on (:online)' if web_search else 'off'}"
                            f" · timeout={int(timeout_s)}s · attempt {attempts}"
                        ),
                    },
                )
                req_start = time.monotonic()
                async with client.stream("POST", OPENROUTER_URL, json=body, headers=headers) as resp:
                    if resp.status_code == 429 and attempts < 2:
                        retry_after = resp.headers.get("Retry-After")
                        base_ms = min(float(retry_after) * 1000, 10_000) if retry_after else 3000
                        wait_ms = base_ms + random.randint(0, 1500)
                        yield Event(
                            type="log",
                            topic=topic,
                            payload={"level": "warn", "message": f"429 rate limited · waiting {wait_ms/1000:.1f}s"},
                        )
                        await _sleep_with_cancel(wait_ms / 1000, cancel)
                        continue
                    if resp.status_code >= 400:
                        text = await resp.aread()
                        raise ProviderError(
                            f"OpenRouter HTTP {resp.status_code}: {text.decode('utf-8', 'replace')[:300]}"
                        )

                    elapsed = time.monotonic() - req_start
                    yield Event(
                        type="log", topic=topic,
                        payload={
                            "level": "success",
                            "message": f"response {resp.status_code} · first byte in {elapsed:.2f}s · streaming…",
                        },
                    )

                    async for ev in _parse_openai_sse(resp, topic, cancel):
                        yield ev
                    return
            except httpx.TimeoutException as e:
                raise ProviderError(f"Timeout after {timeout_s}s") from e


async def _sleep_with_cancel(seconds: float, cancel: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(cancel.wait(), timeout=seconds)
        raise asyncio.CancelledError
    except asyncio.TimeoutError:
        return


async def _parse_openai_sse(
    resp: httpx.Response,
    topic: str,
    cancel: asyncio.Event,
) -> AsyncIterator[Event]:
    text_buf = ""
    seen_titles: set[str] = set()
    sse_buf = ""
    final_usage: dict | None = None

    async for chunk in resp.aiter_text():
        if cancel.is_set():
            raise asyncio.CancelledError
        sse_buf += chunk
        while "\n\n" in sse_buf:
            raw_event, sse_buf = sse_buf.split("\n\n", 1)
            data_line = next(
                (ln for ln in raw_event.splitlines() if ln.startswith("data: ")),
                None,
            )
            if not data_line:
                continue
            payload = data_line[6:].strip()
            if payload == "[DONE]":
                continue
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                continue

            # Usage may arrive on the final chunk with empty choices.
            if "usage" in ev and ev["usage"]:
                final_usage = ev["usage"]

            choices = ev.get("choices") or []
            for choice in choices:
                delta = choice.get("delta") or {}
                content = delta.get("content")
                if content:
                    text_buf += content
                    items = extract_json_array(text_buf) or []
                    for raw in items:
                        card = card_from_raw(raw)
                        if not card or card.title in seen_titles:
                            continue
                        seen_titles.add(card.title)
                        title_preview = card.title[:70] + ("…" if len(card.title) > 70 else "")
                        yield Event(
                            type="log", topic=topic,
                            payload={"level": "success", "message": f"+card · “{title_preview}”"},
                        )
                        yield Event(
                            type="card",
                            topic=topic,
                            payload={"card": card.model_dump(mode="json")},
                        )

    # Final sweep + usage event.
    items = extract_json_array(text_buf) or []
    for raw in items:
        card = card_from_raw(raw)
        if not card or card.title in seen_titles:
            continue
        seen_titles.add(card.title)
        yield Event(type="card", topic=topic, payload={"card": card.model_dump(mode="json")})

    if final_usage:
        yield Event(
            type="usage",
            topic=topic,
            payload={
                "input_tokens": final_usage.get("prompt_tokens", 0),
                "output_tokens": final_usage.get("completion_tokens", 0),
            },
        )
