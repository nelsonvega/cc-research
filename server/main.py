from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import events as events_api
from .api import models_router
from .api import runs as runs_api
from .api import suggest as suggest_api
from .config import settings

app = FastAPI(title="cc-research", version="0.1.0")

# In dev, the Vite server runs on a different port. CORS is permissive on
# localhost only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models_router.router)
app.include_router(runs_api.router)
app.include_router(events_api.router)
app.include_router(suggest_api.router)


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "anthropic": bool(settings.anthropic_api_key),
        "openrouter": bool(settings.openrouter_api_key),
        "data_dir": str(settings.cc_research_data_dir.resolve()),
    }


# Serve the built frontend in production (web/dist). If it's not built, we
# only expose /api/* and the frontend is expected to run via `npm run dev`.
_web_dist = Path(__file__).resolve().parent.parent / "web" / "dist"
if _web_dist.exists():
    app.mount("/assets", StaticFiles(directory=_web_dist / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(_web_dist / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        # Anything that's not /api/* or /assets/* falls back to the SPA.
        if full_path.startswith("api/") or full_path.startswith("assets/"):
            raise FileNotFoundError
        return FileResponse(_web_dist / "index.html")


def run() -> None:
    """Entry point for `cc-research` script."""
    import uvicorn

    uvicorn.run(
        "server.main:app",
        host=settings.cc_research_host,
        port=settings.cc_research_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
