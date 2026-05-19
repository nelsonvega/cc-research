"""End-to-end smoke test using a fake provider.

Verifies that the orchestrator wires together cards → markdown → JSON sidecar
without needing real API keys.
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path

from server import orchestrator
from server.models import Event, RunRequest
from server.store import load_run


class _FakeProvider:
    @staticmethod
    async def stream_research(*, topic, prompt, model, web_search, max_tokens, timeout_s, cancel):
        yield Event(
            type="card",
            topic=topic,
            payload={
                "card": {
                    "title": f"Test card for {topic}",
                    "source_name": "Test Source",
                    "source_url": "https://example.com/a",
                    "published_date": "2026-05-19",
                    "body": "This is a test card body.",
                }
            },
        )
        yield Event(
            type="usage",
            topic=topic,
            payload={"input_tokens": 100, "output_tokens": 50},
        )


def test_run_writes_markdown_and_sidecar(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "anthropic_provider", _FakeProvider)
    monkeypatch.setattr(orchestrator, "openrouter_provider", _FakeProvider)
    # Redirect data dir to tmp_path.
    from server import config, store
    monkeypatch.setattr(config.settings, "cc_research_data_dir", tmp_path)

    async def go():
        req = RunRequest(topics=["AI", "Markets"], sources=[], mode="fast", concurrency=2)
        ctrl = await orchestrator.registry.create(req)
        # Drain SSE-style subscription until done.
        async for ev in ctrl.subscribe():
            if ev.type == "done":
                break
        return ctrl.run_id

    run_id = asyncio.run(go())

    runs_dir = tmp_path / "runs" / run_id
    assert (runs_dir / "run.json").exists(), "run.json missing"
    assert (runs_dir / "index.md").exists(), "index.md missing"
    assert (runs_dir / "ai.md").exists(), "ai.md missing"
    assert (runs_dir / "markets.md").exists(), "markets.md missing"

    payload = json.loads((runs_dir / "run.json").read_text())
    assert payload["status"] == "completed"
    titles = [c["title"] for t in payload["topics"] for c in t["cards"]]
    assert "Test card for AI" in titles
    assert "Test card for Markets" in titles

    ai_md = (runs_dir / "ai.md").read_text()
    assert "# AI" in ai_md
    assert "Test card for AI" in ai_md

    index_md = (runs_dir / "index.md").read_text()
    assert "Research run" in index_md
    assert "[AI](./ai.md)" in index_md


if __name__ == "__main__":
    import tempfile

    class _MP:
        def __init__(self): self._patches = []
        def setattr(self, target, name, value=...):
            if value is ...:
                value = name
                # target is "obj.attr"
                obj_path, attr = target.rsplit(".", 1)
                # not used in this script
            else:
                self._patches.append((target, name, getattr(target, name, None)))
                setattr(target, name, value)
        def undo(self):
            for t, n, v in reversed(self._patches):
                setattr(t, n, v)

    with tempfile.TemporaryDirectory() as td:
        mp = _MP()
        try:
            test_run_writes_markdown_and_sidecar(Path(td), mp)
            print("smoke test passed")
        finally:
            mp.undo()
