"""Run orchestration: one asyncio.gather + semaphore per run."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import AsyncIterator

from .analyzer import analyze_cards
from .config import MODE_DEFAULTS, MODE_MAX_TOKENS, MODE_TIMEOUT_S, provider_for_model, settings
from .models import Card, Event, Run, RunRequest, TokenUsage, TopicResult
from .prompts import build_prompt
from .providers import anthropic as anthropic_provider
from .providers import openrouter as openrouter_provider
from .providers.base import ProviderError
from .store import ensure_run_dir, make_run_id, topic_slug, write_index_md, write_run_json, write_topic_md


def _resolve_models(req: RunRequest) -> list[str]:
    """Final list of models for this run. models[] beats model_override beats mode default."""
    if req.models:
        # de-dupe while preserving order
        seen: set[str] = set()
        out: list[str] = []
        for m in req.models:
            if m and m not in seen:
                seen.add(m)
                out.append(m)
        if out:
            return out
    if req.model_override:
        return [req.model_override]
    return [MODE_DEFAULTS[req.mode]]


def _topic_slug_for(topic: str, model: str, model_count: int) -> str:
    """Disambiguate the file slug when the same topic runs under multiple models."""
    base = topic_slug(topic)
    if model_count <= 1:
        return base
    # Append a sanitized model tag so files don't clobber each other.
    tag = model.replace("/", "-").replace(":", "-")[:32]
    return f"{base}__{tag}"


class RunController:
    def __init__(self, request: RunRequest) -> None:
        self.run_id = make_run_id(request.topics)
        self.request = request
        self.queue: asyncio.Queue[Event] = asyncio.Queue()
        self.cancel = asyncio.Event()
        self.started_at = datetime.utcnow()

        models = _resolve_models(request)
        self.models = models
        web_search = request.mode != "instant"

        topic_results: list[TopicResult] = []
        for t in request.topics:
            for m in models:
                topic_results.append(
                    TopicResult(
                        topic=t,
                        slug=_topic_slug_for(t, m, len(models)),
                        model=m,
                        web_search=web_search,
                    )
                )

        self.run = Run(
            run_id=self.run_id,
            created_at=self.started_at,
            mode=request.mode,
            request=request,
            topics=topic_results,
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
        topics = self.request.topics
        models = self.models
        await self._emit(Event(
            type="log",
            payload={
                "level": "info",
                "message": (
                    f"▶ run {self.run_id} · {len(topics)} topic"
                    f"{'s' if len(topics) != 1 else ''} × {len(models)} model"
                    f"{'s' if len(models) != 1 else ''} = {len(self.run.topics)} tasks"
                    f" · mode={self.request.mode}"
                    f" · concurrency={self.request.concurrency}"
                ),
            },
        ))
        await self._emit(Event(
            type="log",
            payload={"level": "info", "message": f"  topics: {' · '.join(topics)}"},
        ))
        if len(models) > 1:
            await self._emit(Event(
                type="log",
                payload={"level": "info", "message": f"  models: {' · '.join(models)}"},
            ))

        async def run_one(idx: int) -> None:
            tr = self.run.topics[idx]
            topic = tr.topic
            tag = f"{topic} · {tr.model}" if len(models) > 1 else topic
            await self._emit(Event(
                type="log", topic=tag,
                payload={"level": "info", "message": "queued · waiting for slot"},
            ))
            async with sem:
                if self.cancel.is_set():
                    tr.status = "cancelled"
                    await self._emit(Event(
                        type="log", topic=tag,
                        payload={"level": "warn", "message": "cancelled before dispatch"},
                    ))
                    return
                await self._run_topic(idx)

        try:
            await asyncio.gather(*(run_one(i) for i in range(len(self.run.topics))))
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

            # Summary log line: totals across topics.
            total_cards = sum(len(t.cards) for t in self.run.topics)
            total_in = sum(t.tokens.input for t in self.run.topics)
            total_out = sum(t.tokens.output for t in self.run.topics)
            completed = sum(1 for t in self.run.topics if t.status == "completed")
            failed = sum(1 for t in self.run.topics if t.status == "failed")
            duration = (self.run.completed_at - self.run.created_at).total_seconds()
            await self._emit(Event(
                type="log",
                payload={
                    "level": "success" if self.run.status == "completed" else "warn",
                    "message": (
                        f"■ run {self.run.status} · {duration:.1f}s · "
                        f"{completed} ok / {failed} failed · "
                        f"{total_cards} cards · {total_in}/{total_out} tok"
                    ),
                },
            ))
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

        # When multiple models run the same topic, log-tag with the model so
        # streams from siblings don't blur together in the UI/log.
        multi_model = len(self.models) > 1
        topic_tag = f"{topic} · {model}" if multi_model else topic

        prompt = build_prompt(topic, mode, self.request.sources)
        topic_result.status = "running"
        write_run_json(self.run)

        await self._emit(
            Event(
                type="topic_start",
                topic=topic_tag,
                payload={
                    "model": model, "web_search": web_search, "provider": provider_name,
                    "topic_name": topic, "slug": topic_result.slug,
                },
            )
        )
        await self._emit(Event(
            type="log", topic=topic_tag,
            payload={
                "level": "info",
                "message": (
                    f"▸ dispatching · provider={provider_name} · model={model}"
                    f" · web_search={'on' if web_search else 'off'}"
                    f" · max_tokens={max_tokens} · timeout={int(timeout_s)}s"
                ),
            },
        ))

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
                # Rewrite the topic tag so the UI can disambiguate per-model.
                if multi_model:
                    ev = ev.model_copy(update={"topic": topic_tag})
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

            # Post-research analysis: score each card for value + validity.
            if cards_collected and self.request.analyze_cards:
                await self._emit(Event(
                    type="log", topic=topic_tag,
                    payload={"level": "info", "message": f"🔬 analyzing {len(cards_collected)} cards · value + validity…"},
                ))
                analyzer_model = self.request.analyzer_model or model
                scored, an_err = await analyze_cards(
                    cards_collected, topic=topic, model=analyzer_model
                )
                if an_err:
                    await self._emit(Event(
                        type="log", topic=topic_tag,
                        payload={"level": "warn", "message": f"analyzer skipped · {an_err}"},
                    ))
                else:
                    topic_result.cards = scored
                    high_value = sum(1 for c in scored if c.value == "high")
                    high_validity = sum(1 for c in scored if c.validity == "high")
                    await self._emit(Event(
                        type="log", topic=topic_tag,
                        payload={
                            "level": "success",
                            "message": (
                                f"🔬 analysis complete · {high_value} high-value · "
                                f"{high_validity} high-validity"
                            ),
                        },
                    ))
                    # Re-emit cards with scores so the live UI updates.
                    for c in scored:
                        await self._emit(Event(
                            type="card_update", topic=topic_tag,
                            payload={"card": c.model_dump(mode="json")},
                        ))
        except asyncio.CancelledError:
            topic_result.status = "cancelled"
            raise
        except ProviderError as e:
            topic_result.status = "failed"
            topic_result.error = str(e)
            await self._emit(Event(type="error", topic=topic_tag, payload={"message": str(e)}))
        except Exception as e:  # defensive — unexpected errors should not kill siblings
            topic_result.status = "failed"
            topic_result.error = f"{type(e).__name__}: {e}"
            await self._emit(Event(type="error", topic=topic_tag, payload={"message": topic_result.error}))
        finally:
            topic_result.duration_s = time.monotonic() - start
            try:
                write_topic_md(self.run_id, topic_result)
            except Exception as e:
                await self._emit(
                    Event(
                        type="log",
                        topic=topic_tag,
                        payload={"level": "error", "message": f"topic md write failed: {e}"},
                    )
                )
            write_run_json(self.run)
            level = {
                "completed": "success",
                "failed": "error",
                "cancelled": "warn",
            }.get(topic_result.status, "info")
            await self._emit(Event(
                type="log", topic=topic_tag,
                payload={
                    "level": level,
                    "message": (
                        f"◼ {topic_result.status} · {topic_result.duration_s:.1f}s · "
                        f"{len(topic_result.cards)} card"
                        f"{'s' if len(topic_result.cards) != 1 else ''}"
                        f" · {topic_result.tokens.input}/{topic_result.tokens.output} tok"
                        f" · saved to {topic_result.slug}.md"
                    ),
                },
            ))
            await self._emit(
                Event(
                    type="topic_complete",
                    topic=topic_tag,
                    payload={
                        "status": topic_result.status,
                        "duration_s": round(topic_result.duration_s, 2),
                        "topic_name": topic, "slug": topic_result.slug, "model": model,
                    },
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
