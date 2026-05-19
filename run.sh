#!/usr/bin/env bash
# cc-research helper: build, run, commit, develop.
#
# Bare `./run.sh` (no command) prints this help and exits.
# All other commands act explicitly.

set -euo pipefail

cd "$(dirname "$0")"

IMAGE="cc-research:latest"
CONTAINER="cc-research"

# Paths we're willing to commit automatically. Anything outside this list
# stays untouched even if dirty.
COMMIT_PATHS=(
  ".gitignore" ".dockerignore" ".env.example"
  "Dockerfile" "docker-compose.yml" "README.md"
  "pyproject.toml" "uv.lock" "run.sh"
  "server" "tests" "web"
)

usage() {
  cat <<EOF
cc-research — usage: ./run.sh <command>

Docker (recommended path):
  up         Auto-commit pending changes, build the image (cc-research:latest),
             and start the container (cc-research) in the background on
             http://127.0.0.1:8000.
  build      Build the docker image only. Does not start the container.
  down       Stop and remove the container.
  logs       Tail container logs.
  shell      Bash into the running container.
  ps         Show container status.

Local development (no docker):
  dev        Run backend with --reload AND Vite dev server with HMR.
             Backend on :8000, frontend on :5173 (proxies /api to :8000).
  local      Single uvicorn process serving the built frontend on :8000.
  install    uv sync + npm install + frontend build. Run once after cloning.

Maintenance:
  commit [msg]
             Stage known source paths and commit. Default message is
             "wip: \$(timestamp)". Skips if nothing changed.
  test       Run pytest.
  help, -h, --help
             Show this message.

Requirements:
  docker subcommands need: docker + docker compose
  dev/local/install/test  need: uv + node 20+
EOF
}

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "✗ required tool not found: $1" >&2; exit 1; }
}

ensure_env() {
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      echo "→ no .env found; copying .env.example to .env"
      cp .env.example .env
      echo "  edit .env to add ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY, then re-run"
      exit 1
    else
      echo "✗ no .env and no .env.example to copy from" >&2
      exit 1
    fi
  fi
}

auto_commit() {
  if ! command -v git >/dev/null 2>&1 || [[ ! -d .git ]]; then
    return 0  # not a git repo, skip silently
  fi
  # Stage only known paths so .env, data/, caches, etc. stay out.
  local existing=()
  for p in "${COMMIT_PATHS[@]}"; do
    [[ -e "$p" ]] && existing+=("$p")
  done
  if [[ ${#existing[@]} -eq 0 ]]; then return 0; fi
  git add "${existing[@]}" 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "→ no uncommitted source changes"
    return 0
  fi
  local msg="${1:-wip: $(date +%Y-%m-%dT%H:%M:%S)}"
  echo "→ committing pending changes: $msg"
  git commit -m "$msg" >/dev/null
  echo "✓ committed $(git rev-parse --short HEAD)"
}

CMD="${1:-}"

case "$CMD" in
  ""|help|-h|--help)
    usage
    ;;

  up)
    need docker
    ensure_env
    auto_commit
    echo "→ building image $IMAGE"
    docker compose build
    echo "→ starting container $CONTAINER"
    docker compose up -d
    echo
    echo "✓ cc-research is running at http://127.0.0.1:8000"
    echo "  logs:   ./run.sh logs"
    echo "  stop:   ./run.sh down"
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

  commit)
    shift || true
    auto_commit "${1:-}"
    ;;

  test)
    need uv
    uv run pytest -v
    ;;

  *)
    echo "✗ unknown command: $CMD" >&2
    echo
    usage
    exit 1
    ;;
esac
