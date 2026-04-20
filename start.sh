#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# --- Install backend deps if needed ---
if [ ! -d "$BACKEND/.venv" ]; then
  echo "⚙  Creating backend virtual environment…"
  python3 -m venv "$BACKEND/.venv"
fi

echo "⚙  Installing backend dependencies…"
"$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"

# --- Install frontend deps if needed ---
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "⚙  Installing frontend dependencies…"
  (cd "$FRONTEND" && npm install --silent)
fi

# --- Start backend ---
echo "🚀 Starting backend on http://localhost:8000"
"$BACKEND/.venv/bin/uvicorn" main:app --port 8000 --app-dir "$BACKEND" &
BACKEND_PID=$!

# --- Start frontend ---
echo "🚀 Starting frontend on http://localhost:3000"
(cd "$FRONTEND" && npx vite --port 3000) &
FRONTEND_PID=$!

# --- Cleanup on exit ---
cleanup() {
  echo ""
  echo "Shutting down…"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  echo "Done."
}
trap cleanup INT TERM

echo ""
echo "✔ Forgely running — open http://localhost:3000"
echo "  Press Ctrl+C to stop."
echo ""

wait
