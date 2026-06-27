#!/bin/bash
# Start the React frontend dev server
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "→ Starting GraphRAG frontend on http://localhost:5173"
cd "$ROOT/frontend"
npm run dev
