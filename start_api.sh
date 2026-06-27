#!/bin/bash
# Start the FastAPI backend from backend/
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv/bin"

echo "→ Starting GraphRAG API on http://localhost:8000"
cd "$ROOT/backend"
"$VENV/uvicorn" api.main:app --reload --port 8000 --log-level info
