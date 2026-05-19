from __future__ import annotations

import asyncio
from typing import AsyncIterator, Protocol

from ..models import Event


class ResearchProvider(Protocol):
    async def stream_research(
        self,
        *,
        topic: str,
        prompt: str,
        model: str,
        web_search: bool,
        max_tokens: int,
        timeout_s: float,
        cancel: asyncio.Event,
    ) -> AsyncIterator[Event]: ...


class ProviderError(Exception):
    """Raised by providers for non-recoverable errors after retries are exhausted."""
