"""SSE endpoint that streams Events for a run.

If the run is still in memory: subscribe to its live event stream.
If the run only exists on disk: reconstruct a synthetic event stream from
run.json (topic_start + cards + topic_complete + done) so the client can
render it without special-casing finished runs.
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..models import Event
from ..orchestrator import registry
from ..store import load_run

router = APIRouter()


@router.get("/api/runs/{run_id}/events")
async def stream_events(run_id: str) -> EventSourceResponse:
    ctrl = registry.get(run_id)
    if ctrl is not None:
        async def gen():
            async for ev in ctrl.subscribe():
                yield {"event": ev.type, "data": json.dumps(ev.payload | {"topic": ev.topic, "ts": ev.ts.isoformat()})}
        return EventSourceResponse(gen())

    run = load_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found")

    async def replay():
        for t in run.topics:
            for ev in _synth_topic_events(t.topic, t, run.created_at):
                yield {"event": ev.type, "data": json.dumps(ev.payload | {"topic": ev.topic, "ts": ev.ts.isoformat()})}
        duration = (
            (run.completed_at - run.created_at).total_seconds()
            if run.completed_at else 0.0
        )
        ev = Event(type="done", payload={"status": run.status, "duration_s": round(duration, 2)})
        yield {"event": ev.type, "data": json.dumps(ev.payload | {"topic": None, "ts": ev.ts.isoformat()})}

    return EventSourceResponse(replay())


def _synth_topic_events(topic: str, topic_result, base_ts: datetime):
    yield Event(
        type="topic_start",
        topic=topic,
        payload={"model": topic_result.model, "web_search": topic_result.web_search},
    )
    for card in topic_result.cards:
        yield Event(type="card", topic=topic, payload={"card": card.model_dump(mode="json")})
    if topic_result.tokens.input or topic_result.tokens.output:
        yield Event(
            type="usage",
            topic=topic,
            payload={
                "input_tokens": topic_result.tokens.input,
                "output_tokens": topic_result.tokens.output,
            },
        )
    if topic_result.error:
        yield Event(type="error", topic=topic, payload={"message": topic_result.error})
    yield Event(
        type="topic_complete",
        topic=topic,
        payload={"status": topic_result.status, "duration_s": round(topic_result.duration_s, 2)},
    )
