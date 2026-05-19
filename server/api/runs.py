from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from ..config import MODE_DEFAULTS, provider_for_model, settings
from ..models import Run, RunRequest, RunSummary
from ..orchestrator import registry
from ..store import delete_run, list_runs, load_run, run_dir

router = APIRouter()


def _validate_keys_for_request(req: RunRequest) -> None:
    model = req.model_override or MODE_DEFAULTS[req.mode]
    provider = provider_for_model(model)
    if provider == "anthropic" and not settings.anthropic_api_key:
        raise HTTPException(400, "ANTHROPIC_API_KEY is not set on the server")
    if provider == "openrouter" and not settings.openrouter_api_key:
        raise HTTPException(400, "OPENROUTER_API_KEY is not set on the server")


@router.post("/api/runs")
async def create_run(req: RunRequest) -> dict:
    _validate_keys_for_request(req)
    ctrl = await registry.create(req)
    return {"run_id": ctrl.run_id}


@router.get("/api/runs")
def get_runs() -> list[RunSummary]:
    return list_runs()


@router.get("/api/runs/{run_id}")
def get_run(run_id: str) -> Run:
    # Prefer the in-memory live state if the run is active.
    ctrl = registry.get(run_id)
    if ctrl is not None:
        return ctrl.run
    run = load_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/api/runs/{run_id}/topics/{slug}.md")
def export_topic_markdown(run_id: str, slug: str) -> PlainTextResponse:
    """Single topic file. Slug is the topic-slug from RunSummary.topic_details."""
    run = load_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    # Defensive: only serve a slug that belongs to this run.
    valid_slugs = {t.slug for t in run.topics}
    if slug not in valid_slugs:
        raise HTTPException(404, "Topic file not found in this run")
    path = run_dir(run_id) / f"{slug}.md"
    if not path.exists():
        raise HTTPException(404, "Topic file does not exist on disk")
    body = path.read_text(encoding="utf-8")
    return PlainTextResponse(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{run_id}-{slug}.md"'},
    )


@router.get("/api/runs/{run_id}/export.md")
def export_run_markdown(run_id: str) -> PlainTextResponse:
    """Single concatenated markdown document for a finished run.

    Combines the run's index.md and every <topic>.md into one file that
    can be downloaded and read standalone.
    """
    run = load_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    d = run_dir(run_id)
    parts: list[str] = []
    index = d / "index.md"
    if index.exists():
        parts.append(index.read_text(encoding="utf-8").rstrip())
    for t in run.topics:
        topic_md = d / f"{t.slug}.md"
        if topic_md.exists():
            parts.append("\n\n---\n")
            parts.append(topic_md.read_text(encoding="utf-8").rstrip())
    body = "\n".join(parts) + "\n"
    return PlainTextResponse(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{run_id}.md"'},
    )


@router.delete("/api/runs/{run_id}")
def delete_or_cancel(run_id: str) -> dict:
    ctrl = registry.get(run_id)
    if ctrl is not None and ctrl.run.status == "running":
        ctrl.request_cancel()
        return {"action": "cancelled"}
    ok = delete_run(run_id)
    if not ok:
        raise HTTPException(404, "Run not found")
    registry.forget(run_id)
    return {"action": "deleted"}
