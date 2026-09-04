# Forgely — single image, frontend and backend.
#
# One container rather than two: the backend can serve the built frontend, and
# `docker run -p 8000:8000` is the whole story for someone who just wants to
# look at their repositories. It also removes the CORS question entirely — the
# page and the API share an origin.

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend

WORKDIR /build

# Lockfile first, so a source-only change does not reinstall node_modules.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# PYTHONUNBUFFERED so container logs appear as they happen rather than when the
# buffer flushes; PYTHONDONTWRITEBYTECODE because .pyc files in a layer are
# dead weight.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # The scan cache is keyed on scan completion time and never goes stale, so
    # it is worth persisting across runs — mount a volume at /data to keep it.
    FORGELY_CACHE_PATH=/data/scans.db \
    FORGELY_STATIC_DIR=/app/frontend/dist

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /build/dist ./frontend/dist

# Read at runtime: the version banner comes from package.json and the version
# modal fetches CHANGELOG.md. Neither is worth a broken feature to save a few
# kilobytes.
COPY frontend/package.json ./frontend/package.json
COPY CHANGELOG.md ./CHANGELOG.md

# Unprivileged. /data is created and owned here because a volume mounted over
# it inherits this ownership, and the cache is the one thing that writes.
RUN useradd --create-home --uid 10001 forgely \
    && mkdir -p /data \
    && chown -R forgely:forgely /app /data
USER forgely

VOLUME ["/data"]
EXPOSE 8000

# Hits the app rather than the port, so a container that is listening but
# broken is reported unhealthy instead of ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
