from fastapi import APIRouter, HTTPException

from ..config import MODE_DEFAULTS, provider_for_model, settings
from ..models import Run, RunRequest, RunSummary
from ..orchestrator import registry
from ..store import delete_run, list_runs, load_run

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
