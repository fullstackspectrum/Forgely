# Forgely — single image, frontend and backend.
#
# One container rather than two: the backend can serve the built frontend, and
# `docker run -p 8000:8000` is the whole story for someone who just wants to
# look at their repositories. It also removes the CORS question entirely — the
# page and the API share an origin.
#
# Bases are Chainguard throughout. The original python:3.12-slim carried 54
# unfixable CRITICAL/HIGH CVEs — 3 critical, 51 high, every one with no fixed
# version published and not one of them from this project's own dependencies.
# They were OS packages Forgely never calls: perl-base (8), the util-linux
# family (bsdutils, libmount1, libblkid1, libuuid1, login, mount — 4 each),
# libsqlite3, libsystemd, ncurses. `apt-get upgrade` cannot fix an unfixable
# CVE, so the only lever is shipping less operating system.
#
# Measured with `trivy image`, base images only:
#
#     python:3.12-slim                   CRIT=3  HIGH=51  MED=60
#     python:3.12-alpine                 CRIT=0  HIGH=0   MED=5
#     cgr.dev/chainguard/python:latest   CRIT=0  HIGH=0   MED=0

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
#
# Build stages are discarded, so this image's own CVEs never reach anything
# that ships; it is Chainguard for consistency rather than necessity.
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
# The `-dev` variant, because the runtime image below has no pip and no shell —
# that is the whole point of it. Installing straight into the runtime image is
# what fails with "pip: not found"; installing here and copying the result
# across is the distroless pattern.
#
# --user rather than system-wide: these images run as `nonroot`, which cannot
# write to the interpreter's site-packages. It also puts everything under one
# directory that the next stage can copy in a single layer.
# ---------------------------------------------------------------------------
FROM cgr.dev/chainguard/python:latest-dev AS deps

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# Created here so it can be copied in with the right ownership below: the
# runtime image has no shell, so there is no `mkdir` to run in it.
RUN mkdir -p /home/nonroot/data

# ---------------------------------------------------------------------------
# Stage 3 — runtime
#
# Distroless: no shell, no package manager, nothing but the interpreter and
# what we put beside it. `docker exec ... sh` will not work here by design; use
# `docker logs`, or run the -dev image if you need to poke around inside.
# ---------------------------------------------------------------------------
FROM cgr.dev/chainguard/python:latest AS runtime

# PYTHONUNBUFFERED so container logs appear as they happen rather than when the
# buffer flushes; PYTHONDONTWRITEBYTECODE because .pyc files in a layer are
# dead weight.
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

# Read at runtime: the version banner comes from package.json and the version
# modal fetches CHANGELOG.md. Neither is worth a broken feature to save a few
# kilobytes.
COPY --chown=nonroot:nonroot frontend/package.json ./frontend/package.json
COPY --chown=nonroot:nonroot CHANGELOG.md ./CHANGELOG.md

# The base image already runs as nonroot (uid 65532); no user to create.
VOLUME ["/data"]
EXPOSE 8000

# Exec form, and via python rather than a shell: there is no shell to fall back
# on. Hits the app rather than the port, so a container that is listening but
# broken is reported unhealthy instead of ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

# `python -m uvicorn` rather than the `uvicorn` script, so this does not depend
# on PATH resolution inside a distroless image.
ENTRYPOINT ["python", "-m", "uvicorn", "main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
