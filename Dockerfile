# Forgely — single image, frontend and backend.

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
#
# ---------------------------------------------------------------------------
FROM cgr.dev/chainguard/node:latest AS frontend

WORKDIR /build

# Lockfile first, so a source-only change does not reinstall node_modules.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — Python dependencies
#
# ---------------------------------------------------------------------------
FROM cgr.dev/chainguard/python:latest-dev AS deps

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

RUN mkdir -p /home/nonroot/data

# ---------------------------------------------------------------------------
# Stage 3 — runtime
#
# Distroless: no shell
# ---------------------------------------------------------------------------
FROM cgr.dev/chainguard/python:latest AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # The scan cache is keyed on scan completion time and never goes stale, so
    # it is worth persisting across runs — mount a volume at /data to keep it.
    FORGELY_CACHE_PATH=/data/scans.db \
    FORGELY_STATIC_DIR=/app/frontend/dist \
    PATH=/home/nonroot/.local/bin:$PATH

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /home/nonroot/.local /home/nonroot/.local
# A volume mounted over /data inherits this ownership, and the cache is the one
# thing that writes.
COPY --from=deps --chown=nonroot:nonroot /home/nonroot/data /data

COPY --chown=nonroot:nonroot backend/ ./backend/
COPY --from=frontend --chown=nonroot:nonroot /build/dist ./frontend/dist

COPY --chown=nonroot:nonroot frontend/package.json ./frontend/package.json
COPY --chown=nonroot:nonroot CHANGELOG.md ./CHANGELOG.md

# The base image already runs as nonroot (uid 65532); no user to create.
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["python", "-m", "uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
