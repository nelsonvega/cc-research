# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build the React frontend ----------
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build


# ---------- Stage 2: Python runtime with built frontend baked in ----------
FROM python:3.13-slim

# Install uv (the project's package manager) into the system Python.
RUN pip install --no-cache-dir uv

WORKDIR /app

# Install Python deps first so layer caches when only app code changes.
# --no-install-project: skip installing cc-research itself (uvicorn just
# imports the `server` package from the working dir). Avoids needing
# README.md in the build context.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# App code + built frontend.
COPY server/ ./server/
COPY --from=web /web/dist ./web/dist

ENV CC_RESEARCH_HOST=0.0.0.0 \
    CC_RESEARCH_PORT=8000 \
    CC_RESEARCH_DATA_DIR=/app/data \
    PYTHONUNBUFFERED=1

RUN mkdir -p /app/data/runs

EXPOSE 8000
VOLUME ["/app/data"]

# Healthcheck hits the FastAPI health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3).status==200 else 1)"

CMD ["uv", "run", "--no-sync", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
