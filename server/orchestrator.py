"""Run orchestration: one asyncio.gather + semaphore per run."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import AsyncIterator

from .config import MODE_DEFAULTS, MODE_MAX_TOKENS, MODE_TIMEOUT_S, provider_for_model, settings
from .models import Card, Event, Run, RunRequest, TokenUsage, TopicResult
from .prompts import build_prompt
from .providers import anthropic as anthropic_provider
from .providers import openrouter as openrouter_provider
from .providers.base import ProviderError
from .store import ensure_run_dir, make_run_id, topic_slug, write_index_md, write_run_json, write_topic_md


class RunController:
    def __init__(self, request: RunRequest) -> None:
        self.run_id = make_run_id(request.topics)
        self.request = request
        self.queue: asyncio.Queue[Event] = asyncio.Queue()
        self.cancel = asyncio.Event()
        self.started_at = datetime.utcnow()
        self.run = Run(
            run_id=self.run_id,
            created_at=self.started_at,
            mode=request.mode,
            request=request,
            topics=[
                TopicResult(
                    topic=t,
                    slug=topic_slug(t),
                    model=request.model_override or MODE_DEFAULTS[request.mode],
                    web_search=request.mode != "instant",
                )
                for t in request.topics
            ],
        )
        self._main_task: asyncio.Task | None = None
        self._done = asyncio.Event()
        self._history: list[Event] = []  # for late SSE subscribers
        ensure_run_dir(self.run_id)
        write_run_json(self.run)

    def start(self) -> None:
        self._main_task = asyncio.create_task(self._run_all())

    async def _emit(self, ev: Event) -> None:
        self._history.append(ev)
        await self.queue.put(ev)

    async def _run_all(self) -> None:
        sem = asyncio.Semaphore(self.request.concurrency)
        await self._emit(
            Event(
                type="log",
                payload={
                    "level": "info",
                    "message": f"Run started · {len(self.request.topics)} topics · mode={self.request.mode} · concurrency={self.request.concurrency}",
                },
            )
        )

        async def run_one(idx: int) -> None:
            async with sem:
                if self.cancel.is_set():
                    self.run.topics[idx].status = "cancelled"
                    return
                await self._run_topic(idx)

        try:
            await asyncio.gather(*(run_one(i) for i in range(len(self.request.topics))))
        finally:
            self.run.completed_at = datetime.utcnow()
            if self.cancel.is_set():
                self.run.status = "cancelled"
            elif all(t.status == "failed" for t in self.run.topics):
                self.run.status = "failed"
            elif any(t.status == "failed" for t in self.run.topics):
                # mixed — call it completed; per-topic status tells the full story
                self.run.status = "completed"
            else:
                self.run.status = "completed"
            write_run_json(self.run)
            try:
                write_index_md(self.run)
            except Exception as e:
                await self._emit(
                    Event(type="log", payload={"level": "error", "message": f"index.md write failed: {e}"})
                )
            duration = (self.run.completed_at - self.run.created_at).total_seconds()
            await self._emit(
                Event(type="done", payload={"status": self.run.status, "duration_s": round(duration, 2)})
            )
            self._done.set()

    async def _run_topic(self, idx: int) -> None:
        topic_result = self.run.topics[idx]
        topic = topic_result.topic
        model = topic_result.model
        provider_name = provider_for_model(model)
        web_search = topic_result.web_search
        mode = self.request.mode
        timeout_s = MODE_TIMEOUT_S[mode]
        max_tokens = MODE_MAX_TOKENS[mode]

        prompt = build_prompt(topic, mode, self.request.sources)
        topic_result.status = "running"
        write_run_json(self.run)

        await self._emit(
            Event(
                type="topic_start",
                topic=topic,
                payload={"model": model, "web_search": web_search, "provider": provider_name},
            )
        )

        provider = anthropic_provider if provider_name == "anthropic" else openrouter_provider
        start = time.monotonic()
        try:
            cards_collected: list[Card] = []
            usage = TokenUsage()
            async for ev in provider.stream_research(
                topic=topic,
                prompt=prompt,
                model=model,
                web_search=web_search,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
                cancel=self.cancel,
            ):
                await self._emit(ev)
                if ev.type == "card":
                    cards_collected.append(Card.model_validate(ev.payload["card"]))
                elif ev.type == "usage":
                    usage = TokenUsage(
                        input=ev.payload.get("input_tokens", 0),
                        output=ev.payload.get("output_tokens", 0),
                    )

            topic_result.cards = cards_collected
            topic_result.tokens = usage
            topic_result.status = "completed"
        except asyncio.CancelledError:
            topic_result.status = "cancelled"
            raise
        except ProviderError as e:
            topic_result.status = "failed"
            topic_result.error = str(e)
            await self._emit(Event(type="error", topic=topic, payload={"message": str(e)}))
        except Exception as e:  # defensive — unexpected errors should not kill siblings
            topic_result.status = "failed"
            topic_result.error = f"{type(e).__name__}: {e}"
            await self._emit(Event(type="error", topic=topic, payload={"message": topic_result.error}))
        finally:
            topic_result.duration_s = time.monotonic() - start
            try:
                write_topic_md(self.run_id, topic_result)
            except Exception as e:
                await self._emit(
                    Event(
                        type="log",
                        topic=topic,
                        payload={"level": "error", "message": f"topic md write failed: {e}"},
                    )
                )
            write_run_json(self.run)
            await self._emit(
                Event(
                    type="topic_complete",
                    topic=topic,
                    payload={"status": topic_result.status, "duration_s": round(topic_result.duration_s, 2)},
                )
            )

    async def subscribe(self) -> AsyncIterator[Event]:
        """Replay history then stream new events until done."""
        for ev in list(self._history):
            yield ev
        idx = len(self._history)
        while not self._done.is_set() or idx < len(self._history):
            try:
                ev = await asyncio.wait_for(self.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if self._done.is_set() and idx >= len(self._history):
                    return
                continue
            idx += 1
            yield ev

    def request_cancel(self) -> None:
        self.cancel.set()


class RunRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, RunController] = {}
        self._lock = asyncio.Lock()

    async def create(self, request: RunRequest) -> RunController:
        async with self._lock:
            ctrl = RunController(request)
            self._runs[ctrl.run_id] = ctrl
            ctrl.start()
            return ctrl

    def get(self, run_id: str) -> RunController | None:
        return self._runs.get(run_id)

    def forget(self, run_id: str) -> None:
        self._runs.pop(run_id, None)


registry = RunRegistry()
