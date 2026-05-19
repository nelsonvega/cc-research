---
noteId: "f568970053be11f1bdec53ceb3d5d66a"
tags: []

---

# cc-research

Multi-provider parallel news research. Built from `news-dashboard.jsx` (originally a Claude artifact) into a real app:

- **Backend:** FastAPI + httpx + SSE (Python 3.13, managed by `uv`)
- **Frontend:** React + TypeScript + Vite + zustand
- **Providers:** Claude (native `web_search` tool) and OpenRouter (any model, `:online` plugin for web access)
- **Persistence:** one folder per run under `data/runs/` — markdown for humans, `run.json` sidecar for the app
- **Parallelism:** topics run concurrently with a configurable semaphore (asyncio)
- **Ships as:** a single Docker image (`cc-research:latest`) — or run locally with `uv` + Node

---

## Quick start (Docker)

```bash
cp .env.example .env
# edit .env and add ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY

./run.sh up
```

Open <http://127.0.0.1:8000>. Stop with `./run.sh down`.

`./run.sh up` builds the image (`cc-research:latest`), starts a container named `cc-research`, mounts `./data` for run persistence, reads keys from `.env`, and binds port 8000 to localhost only.

---

## `run.sh` commands

`run.sh` is the single entry point. It auto-creates `.env` from `.env.example` on first run if missing.

| Command | What it does |
|---|---|
| `./run.sh` *(or `up`)* | Build image + start container in background |
| `./run.sh down` | Stop and remove the container |
| `./run.sh logs` | Tail container logs |
| `./run.sh shell` | `bash` into the running container |
| `./run.sh build` | Build the Docker image only (no run) |
| `./run.sh ps` | Container status |
| `./run.sh dev` | Local dev mode: uvicorn `--reload` + Vite hot reload (no Docker) |
| `./run.sh local` | Local "prod-ish": built frontend, single uvicorn process (no Docker) |
| `./run.sh install` | `uv sync` + `npm install` + frontend build (no run) |
| `./run.sh test` | Run pytest |

Requirements:
- Docker subcommands: `docker` + `docker compose`
- `dev` / `local` / `install` / `test`: `uv` + Node 20+

---

## Local development (no Docker)

Two processes with hot reload:

```bash
./run.sh install   # first time: uv sync + npm install + build
./run.sh dev       # starts uvicorn (reload) + vite (hmr)
```

Open <http://localhost:5173>. Vite proxies `/api/*` to uvicorn on `:8000`.

Or do it manually:

```bash
# terminal 1 — backend
uv run uvicorn server.main:app --reload --port 8000

# terminal 2 — frontend
cd web && npm run dev
```

## Local production-style run

Single uvicorn process serving the built frontend + API:

```bash
./run.sh local
# or: uv run cc-research
```

Open <http://localhost:8000>.

---

## Modes

| Mode | Default model | Web search | Items | Per-topic timeout |
|---|---|---|---|---|
| `instant`  | `claude-haiku-4-5`  | no  | 2    | 15s |
| `fast`     | `claude-sonnet-4-6` | yes | 2–3  | 30s |
| `thorough` | `claude-sonnet-4-6` | yes | 3–5  | 60s |
| `deep`     | `claude-opus-4-7`   | yes | 6–10 | 240s |

The model dropdown overrides the default for the whole run. Claude models go through `api.anthropic.com` with the native `web_search_20250305` tool. OpenRouter models get `:online` appended for web access via OpenRouter's built-in plugin.

---

## Run output

Each run creates a folder under `data/runs/`:

```
2026-05-19T143052Z-ai-markets-tech/
├── index.md             # YAML frontmatter + topic links
├── run.json             # complete structured data (source of truth)
├── artificial-intelligence.md
├── financial-markets.md
└── technology.md
```

- `index.md` — human overview with frontmatter metadata
- `<topic>.md` — one per topic, each card rendered as `## title` + source line + body
- `run.json` — the full `Run` object; used by the UI to re-render historical runs

Writes are atomic (`.tmp` + `os.replace`). `run.json` is updated three times: run start, each topic completion, run end. Markdown files are written at run/topic completion only.

`data/` is gitignored. Browse the markdown in any editor — it stands alone.

---

## Docker details

### Image

Built by the top-level `Dockerfile` in two stages:

1. **`web` stage** (`node:20-alpine`) — `npm ci` + `npm run build` produces `web/dist/`
2. **runtime stage** (`python:3.13-slim`) — installs `uv`, runs `uv sync --frozen --no-dev --no-install-project` to install Python deps from `uv.lock`, then copies `server/` and the built `web/dist/` from stage 1

`CMD` runs `uv run --no-sync uvicorn server.main:app --host 0.0.0.0 --port 8000`. The `--no-install-project` + `--no-sync` pair means uvicorn imports `server.main` directly from the working directory (no need to install cc-research as a wheel) and the container never re-runs `uv sync` at startup.

`HEALTHCHECK` polls `/api/health` every 30s. `EXPOSE 8000`. `VOLUME ["/app/data"]`.

### Compose

`docker-compose.yml`:

```yaml
services:
  cc-research:
    container_name: cc-research
    image: cc-research:latest
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:8000:8000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

- Port is bound to `127.0.0.1` only — not exposed on your LAN. Change to `"8000:8000"` to expose it everywhere.
- `./data` is bind-mounted, so run output survives container restarts and is browsable from the host.
- API keys come from `.env` via `env_file` — the file is never copied into the image.

### `.dockerignore`

Excludes `.venv`, `node_modules`, `data/`, `.env`, tests, docs, and the original 171 KB `news-dashboard.jsx` from the build context so layers cache well and secrets/local state can't leak in.

### Manual Docker commands

If you prefer not to use `run.sh`:

```bash
docker compose build              # build cc-research:latest
docker compose up -d              # start the container
docker compose logs -f            # tail logs
docker compose down               # stop and remove
docker exec -it cc-research bash  # shell into container
```

Or pure `docker`:

```bash
docker build -t cc-research:latest .
docker run -d --name cc-research \
  -p 127.0.0.1:8000:8000 \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  --restart unless-stopped \
  cc-research:latest
```

---

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY`                 | —          | Required for `claude-*` models. |
| `OPENROUTER_API_KEY`                | —          | Required for any non-Claude model. |
| `CC_RESEARCH_DATA_DIR`              | `data`     | Where runs are written. Docker image overrides this to `/app/data`. |
| `CC_RESEARCH_MAX_CONCURRENT_TOPICS` | `3`        | Per-run semaphore cap (the UI slider clamps 1–8). |
| `CC_RESEARCH_HOST`                  | `127.0.0.1`| Bind address. Docker image overrides this to `0.0.0.0`. |
| `CC_RESEARCH_PORT`                  | `8000`     | Bind port. |

You can run with only one provider configured — the model picker hides models for the missing provider.

---

## Architecture

```
HTTP request                Provider streams
─────────────                ────────────────
POST /api/runs   →  RunController  ──┬──→  anthropic.stream_research()
                       │              ├──→  anthropic.stream_research()
                       │              └──→  openrouter.stream_research()
                       │  asyncio.Semaphore(N)
                       ▼
                  Event queue ──→  /api/runs/<id>/events  (SSE → browser)
                       │
                       └────────────→  data/runs/<id>/*.md + run.json
```

| Module | Responsibility |
|---|---|
| `server/providers/base.py` | `ResearchProvider` Protocol + `ProviderError` |
| `server/providers/anthropic.py` | `api.anthropic.com/v1/messages` streaming, native `web_search` tool |
| `server/providers/openrouter.py` | OpenAI-compatible `chat/completions` streaming, `:online` web plugin |
| `server/orchestrator.py` | `RunController` — per-run event queue, `asyncio.gather` + `Semaphore`, cancel/timeout/error isolation per topic |
| `server/prompts.py` | The four mode prompts (`instant` / `fast` / `thorough` / `deep`) lifted from the JSX |
| `server/store.py` | Disk I/O: atomic markdown + JSON sidecar, tolerant JSON extraction, slugify |
| `server/api/runs.py` | `POST/GET/DELETE /api/runs` |
| `server/api/events.py` | `GET /api/runs/{id}/events` (SSE) — replays from disk for finished runs |
| `server/api/models_router.py` | `GET /api/models` — only returns models for providers with keys configured |
| `server/main.py` | FastAPI app, CORS, mounts the built SPA at `/` with fallback for client-side routes |

Frontend mirrors the same surface area:

| Frontend file | Responsibility |
|---|---|
| `web/src/api.ts` | Typed `fetch` client + SSE subscription wrapper |
| `web/src/state/settings.ts` | Topics, sources, mode, model override, concurrency — persisted to `localStorage` |
| `web/src/state/liveRun.ts` | In-flight run: per-topic status, cards, tokens, elapsed timer, log buffer |
| `web/src/state/runs.ts` | Past runs (from `/api/runs`) + currently viewed run |
| `web/src/state/models.ts` | `/api/models` snapshot, loaded once at startup |
| `web/src/components/*.tsx` | One component per concern — no monolithic JSX |

---

## Testing

```bash
./run.sh test
# or directly:
uv run pytest -v
```

`tests/test_smoke.py` runs an orchestrator round-trip with a fake provider and asserts the on-disk output shape (markdown + JSON sidecar + index).

---

## Deferred from v1

These features exist in the original `news-dashboard.jsx` and were intentionally not ported in the first pass — they each need their own backend endpoint and aren't part of the core research-to-markdown loop:

- AI-suggested sources (keyword and topic-based)
- AI-suggested topics
- Markdown-paste source import
- Per-source topic scoping in the UI (the model supports it on the backend — the UI just always sends `topics: []`)
- Run TTL / dedupe ("you ran this 10 min ago, reuse?")
