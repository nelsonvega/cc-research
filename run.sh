#!/usr/bin/env bash
# Build and run cc-research. Default command is `docker` — builds the image
# tagged `cc-research:latest` and starts it via docker compose.
#
# Usage:
#   ./run.sh              # build + start docker container (same as `up`)
#   ./run.sh up           # build + start in background
#   ./run.sh down         # stop and remove container
#   ./run.sh logs         # tail container logs
#   ./run.sh build        # only build the image
#   ./run.sh shell        # exec a shell into the running container
#   ./run.sh dev          # run backend + frontend locally with hot reload
#   ./run.sh install      # uv sync + npm install + npm run build (no docker)
#   ./run.sh local        # install + run uvicorn locally without docker
#   ./run.sh test         # run pytest
#
# Requires: docker + docker compose (for docker subcommands)
#           uv + node 20+   (for dev / local / install / test)

set -euo pipefail

cd "$(dirname "$0")"

CMD="${1:-up}"
IMAGE="cc-research:latest"
CONTAINER="cc-research"

ensure_env() {
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      echo "→ no .env found; copying .env.example to .env"
      cp .env.example .env
      echo "  edit .env to add ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY, then re-run"
      exit 1
    else
      echo "✗ no .env and no .env.example to copy from"
      exit 1
    fi
  fi
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ required tool not found: $1"; exit 1; }
}

case "$CMD" in
  up|docker|"")
    need docker
    ensure_env
    echo "→ building image $IMAGE"
    docker compose build
    echo "→ starting container $CONTAINER"
    docker compose up -d
    echo
    echo "✓ cc-research is running at http://127.0.0.1:8000"
    echo "  logs:  ./run.sh logs"
    echo "  stop:  ./run.sh down"
    ;;

  build)
    need docker
    docker compose build
    echo "✓ built $IMAGE"
    ;;

  down|stop)
    need docker
    docker compose down
    echo "✓ stopped"
    ;;

  logs)
    need docker
    docker compose logs -f cc-research
    ;;

  shell|exec)
    need docker
    docker exec -it "$CONTAINER" /bin/bash
    ;;

  ps|status)
    need docker
    docker compose ps
    ;;

  dev)
    need uv
    need node
    ensure_env
    echo "→ starting backend (uvicorn --reload) on :8000"
    uv run uvicorn server.main:app --reload --port 8000 &
    BACK_PID=$!
    trap 'kill $BACK_PID 2>/dev/null || true' EXIT
    echo "→ starting frontend (vite dev) on :5173"
    (cd web && npm run dev)
    ;;

  install)
    need uv
    need node
    echo "→ uv sync"
    uv sync
    echo "→ web: npm install + build"
    (cd web && npm install && npm run build)
    echo "✓ installed; run './run.sh local' or './run.sh up'"
    ;;

  local)
    need uv
    ensure_env
    if [[ ! -d web/dist ]]; then
      echo "→ web/dist not found; building frontend first"
      need node
      (cd web && npm install && npm run build)
    fi
    echo "→ starting uvicorn on http://127.0.0.1:8000"
    exec uv run uvicorn server.main:app --host 127.0.0.1 --port 8000
    ;;

  test)
    need uv
    uv run pytest -v
    ;;

  *)
    cat <<EOF
Unknown command: $CMD

Usage:
  ./run.sh              build + start docker (default)
  ./run.sh up           build + start docker
  ./run.sh down         stop docker
  ./run.sh logs         tail docker logs
  ./run.sh shell        bash into the running container
  ./run.sh build        build the docker image only
  ./run.sh ps           show container status
  ./run.sh dev          local dev (backend reload + vite hot reload)
  ./run.sh local        local prod-ish (built frontend, uvicorn only)
  ./run.sh install      uv sync + npm install + frontend build
  ./run.sh test         run pytest
EOF
    exit 1
    ;;
esac
