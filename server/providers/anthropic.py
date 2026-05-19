"""Anthropic streaming provider.

Calls POST /v1/messages with stream=true. When web_search is on, attaches
the native web_search_20250305 tool. Emits Event objects as SSE arrives:
  - tool_use   when the model calls web_search (one event per query)
  - card       when a complete JSON object can be parsed from accumulated text
  - usage      at message_delta with final usage
  - log        for retries, status, errors
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

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


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
    if not settings.anthropic_api_key:
        raise ProviderError("ANTHROPIC_API_KEY is not set")

    body: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "stream": True,
        "messages": [{"role": "user", "content": prompt}],
    }
    if web_search:
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search"}]

    headers = {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropic_api_key.get_secret_value(),
        "anthropic-version": ANTHROPIC_VERSION,
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
                            f"POST /v1/messages · model={model} · max_tokens={max_tokens}"
                            f" · web_search={'on' if web_search else 'off'}"
                            f" · timeout={int(timeout_s)}s · attempt {attempts}"
                        ),
                    },
                )
                req_start = time.monotonic()
                async with client.stream("POST", ANTHROPIC_URL, json=body, headers=headers) as resp:
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
                            f"Anthropic HTTP {resp.status_code}: {text.decode('utf-8', 'replace')[:300]}"
                        )

                    elapsed = time.monotonic() - req_start
                    yield Event(
                        type="log", topic=topic,
                        payload={
                            "level": "success",
                            "message": f"response {resp.status_code} · first byte in {elapsed:.2f}s · streaming…",
                        },
                    )

                    async for event in _parse_sse(resp, topic, cancel):
                        yield event
                    return
            except httpx.TimeoutException as e:
                raise ProviderError(f"Timeout after {timeout_s}s") from e


async def _sleep_with_cancel(seconds: float, cancel: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(cancel.wait(), timeout=seconds)
        # cancel fired
        raise asyncio.CancelledError
    except asyncio.TimeoutError:
        return


async def _parse_sse(
    resp: httpx.Response,
    topic: str,
    cancel: asyncio.Event,
) -> AsyncIterator[Event]:
    """Parse Anthropic's SSE stream and emit Events.

    Accumulates text delta from all text content blocks. Whenever the buffer
    contains at least one complete top-level JSON object, parse what's parseable
    and emit a `card` event for each new item.
    """
    text_buf = ""
    seen_titles: set[str] = set()
    sse_buf = ""
    # Track tool_use blocks by content block index so we can accumulate
    # partial JSON deltas and surface the search query once it's complete.
    tool_blocks: dict[int, dict] = {}
    search_count = 0

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
            try:
                ev = json.loads(data_line[6:])
            except json.JSONDecodeError:
                continue

            etype = ev.get("type")
            block_idx = ev.get("index")

            if etype == "content_block_start":
                block = ev.get("content_block") or {}
                if block.get("type") == "tool_use" and block.get("name") == "web_search":
                    tool_blocks[block_idx] = {"input_json": "", "logged": False}
                    yield Event(
                        type="log", topic=topic,
                        payload={"level": "info", "message": "🔎 web_search · sending query…"},
                    )

            elif etype == "content_block_delta":
                delta = ev.get("delta") or {}
                dtype = delta.get("type")
                if dtype == "text_delta":
                    text_buf += delta.get("text", "")
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
                elif dtype == "input_json_delta":
                    # Accumulate partial JSON for the tool call; once parseable,
                    # log the actual search query.
                    blk = tool_blocks.get(block_idx)
                    if blk is not None:
                        blk["input_json"] += delta.get("partial_json", "")
                        if not blk["logged"]:
                            try:
                                parsed = json.loads(blk["input_json"])
                            except json.JSONDecodeError:
                                parsed = None
                            if isinstance(parsed, dict) and parsed.get("query"):
                                search_count += 1
                                query = str(parsed["query"])
                                blk["logged"] = True
                                yield Event(
                                    type="tool_use", topic=topic,
                                    payload={"tool": "web_search", "query": query, "n": search_count},
                                )
                                yield Event(
                                    type="log", topic=topic,
                                    payload={
                                        "level": "info",
                                        "message": f"🔎 search #{search_count} · “{query}”",
                                    },
                                )

            elif etype == "content_block_stop":
                # If the tool block ended without us seeing a parseable query,
                # try one more time and log whatever was sent.
                blk = tool_blocks.get(block_idx)
                if blk is not None and not blk["logged"]:
                    try:
                        parsed = json.loads(blk["input_json"]) if blk["input_json"] else None
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict) and parsed.get("query"):
                        search_count += 1
                        query = str(parsed["query"])
                        blk["logged"] = True
                        yield Event(
                            type="tool_use", topic=topic,
                            payload={"tool": "web_search", "query": query, "n": search_count},
                        )
                        yield Event(
                            type="log", topic=topic,
                            payload={"level": "info", "message": f"🔎 search #{search_count} · “{query}”"},
                        )

            elif etype == "message_delta":
                usage = (ev.get("usage") or {})
                if usage:
                    yield Event(
                        type="usage",
                        topic=topic,
                        payload={
                            "input_tokens": usage.get("input_tokens", 0),
                            "output_tokens": usage.get("output_tokens", 0),
                        },
                    )

            elif etype == "message_stop":
                # Final sweep in case the last card only became parseable here.
                items = extract_json_array(text_buf) or []
                for raw in items:
                    card = card_from_raw(raw)
                    if not card or card.title in seen_titles:
                        continue
                    seen_titles.add(card.title)
                    yield Event(
                        type="card",
                        topic=topic,
                        payload={"card": card.model_dump(mode="json")},
                    )
                return

            elif etype == "error":
                err = (ev.get("error") or {}).get("message") or "unknown stream error"
                raise ProviderError(f"Anthropic stream error: {err}")
