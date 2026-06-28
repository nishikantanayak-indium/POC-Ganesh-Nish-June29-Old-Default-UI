# GraphRAG — Procurement Intelligence Suite

> **A multi-workspace knowledge graph platform for procurement document analysis.**
> Each workspace is an isolated analysis environment. Upload RFP + Risk Sheet + Contract → automated pipeline → interactive graph → traceability lineage → natural language Q&A.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Configuration Reference](#configuration-reference)
6. [Project Structure](#project-structure)
7. [UI Walkthrough](#ui-walkthrough)
8. [Continuing Development](#continuing-development)
9. [Troubleshooting](#troubleshooting)

---

## What This Does

The platform lets analysts run multiple independent procurement analyses side-by-side — each in its own workspace with fully isolated graph data, vector indexes, and pipeline state.

| Input | Output |
|-------|--------|
| RFP / RFX (PDF or DOCX) | Typed `Requirement` nodes |
| Risk Sheet (PDF or DOCX) | Typed `Risk` + `Mitigation` nodes |
| Contract / Offer (PDF or DOCX) | Typed `Clause` + `LD` nodes |

All nodes land in **Neo4j**, scoped to the workspace. Typed edges (`COVERS`, `INTRODUCES_RISK`, `MITIGATED_BY`, `LINKED_TO_LD`, …) connect them across documents. Within each workspace you can:

- Watch a real-time animated pipeline process your documents step by step
- Explore an interactive force-directed knowledge graph — drag nodes freely, zoom, expand neighbourhoods
- Get a traceability lineage — which requirements are covered, partial, or missing, with inter-document vs intra-document badges
- Ask natural language questions — answered by graph traversal + semantic search, cited to exact sections

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  React Frontend  (Vite · TypeScript · React Router v7)               │
│  localhost:5173                                                        │
│                                                                        │
│  /                  → Workspace Grid (create / open / delete)         │
│  /workspace/:id     → Workspace App (Ingest · Graph · Traceability    │
│                                       Elements · Chat)                 │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTP + SSE (streaming)
┌────────────────────────────▼─────────────────────────────────────────┐
│  FastAPI Backend  (uvicorn · localhost:8000)                          │
│                                                                        │
│  GET/POST /api/workspaces                    — workspace CRUD         │
│  POST /api/workspaces/{id}/pipeline/run      — SSE streaming pipeline │
│  GET  /api/workspaces/{id}/graph/data        — React Flow nodes+edges │
│  GET  /api/workspaces/{id}/graph/subgraph    — 1-hop neighbourhood    │
│  GET  /api/workspaces/{id}/traceability/*    — coverage + chain       │
│  POST /api/workspaces/{id}/chat/ask          — intent-aware Q&A       │
│  GET  /api/workspaces/{id}/elements          — all elements           │
└───┬──────────────┬──────────────┬────────────────────────────────────┘
    │              │              │
┌───▼───┐      ┌───▼──────┐  ┌───▼─────────────────────────────────┐
│Neo4j  │      │ Qdrant   │  │  PostgreSQL                         │
│:7687  │      │ :6333    │  │  :5432                              │
│       │      │          │  │  workspaces (id, name, desc,        │
│ Per-  │      │ Per-     │  │  created_at, updated_at)            │
│ work- │      │ workspace│  └─────────────────────────────────────┘
│ space │      │ ws_{id}  │
│ nodes │      │          │
└───────┘      └──────────┘
```

### Workspace isolation

| Layer | Isolation mechanism |
|-------|-------------------|
| **PostgreSQL** | One row per workspace — metadata only |
| **Neo4j** | Composite unique constraint `(id, workspace_id) IS UNIQUE` on `Element` nodes; all queries filter by `workspace_id` |
| **Qdrant** | Separate collection per workspace: `ws_{workspace_id}` |
| **Pipeline** | Per-workspace coordinator and write lock — concurrent runs in the same workspace are serialised; different workspaces run fully in parallel |

### Pipeline — five steps

```
1  Parse          PDF/DOCX → text pages
                  ┌ Digital PDF  → PyMuPDF native text extraction (fast)
                  └ Scanned PDF  → PyMuPDF render at 200 DPI → Tesseract OCR
                    Pages with > 40% non-ASCII chars are dropped (filters CJK/garbled OCR)
                  SHA-256 dedup skips already-ingested files

2  Extract (LLM)  Section-aware chunking: section headers detected per page
                  (Section X / 3.1.2 / APPENDIX A / GCC 6.1 / IV. …)
                  Each chunk is prefixed with [Section label | Page N] so GPT-4o
                  knows its structural context.
                  GPT-4o function calling → AtomicElement objects:
                    Requirement / Clause / Risk / Mitigation / LD
                  Every element carries: section, page_number, source (accurate section ref)
                  IDs are doc-scoped: RFP1_REQ_001, CONT_CL_001 — prevents Neo4j collisions

3  Build Graph    Cross-document relationship extraction (coordinator pattern):
                  If multiple pipelines finish extraction at the same time, they share
                  a single combined LLM call — so no cross-document relationships are
                  missed because two uploads ran concurrently.
                  → COVERS / PARTIALLY_COVERS / INTRODUCES_RISK /
                     MITIGATED_BY / LINKED_TO_LD / CONTRADICTS
                  Written into Neo4j with Cypher MERGE (idempotent, workspace-scoped)

4  Index Vectors  BGE-M3 embeddings of all elements → workspace Qdrant collection
                  Payload includes: section, page_number — enables section-scoped search
                  Powers semantic Q&A retrieval

5  Coverage       Graph traversal per Requirement
                  → Covered / Partially Covered / Not Covered
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Vite · React Router v7 · React Flow v12 · d3-force · Tailwind CSS · Framer Motion |
| API | FastAPI · uvicorn · SSE streaming |
| LLM extraction | GPT-4o (OpenAI function calling — structured output) |
| Graph store | Neo4j 5.x (Cypher MERGE, typed edges, composite workspace constraint) |
| Vector store | Qdrant (per-workspace collections) |
| Embeddings | BAAI/bge-m3 (sentence-transformers, 1024-dim) |
| Workspace metadata | PostgreSQL 16 (via psycopg2) |
| OCR | Tesseract 5.x + pytesseract + PyMuPDF rendering (scanned PDF fallback) |

---

## Prerequisites

### System requirements

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| Docker Desktop | 4.x | `docker --version` |
| Tesseract | 4.x+ | `tesseract --version` |

**Install Tesseract (required for scanned PDFs):**

```bash
# macOS
brew install tesseract

# Ubuntu / Debian
sudo apt-get install tesseract-ocr
```

> Tesseract is only needed if you upload scanned PDFs (image-based, no embedded text layer). Digital PDFs and DOCX files work without it.

### API keys

| Service | Where to get it | Required? |
|---------|----------------|-----------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Yes** — GPT-4o for extraction and Q&A |

> GPT-4o costs approximately **$0.02–0.15 per document** (element extraction + cross-document relationship extraction).

### Ports that must be free

| Port | Used by |
|------|--------|
| `5432` | PostgreSQL (workspace metadata) |
| `7474` | Neo4j browser (optional debug UI) |
| `7687` | Neo4j Bolt |
| `6333` | Qdrant REST |
| `6334` | Qdrant gRPC |
| `8000` | FastAPI backend |
| `5173` | React frontend (Vite dev server) |

---

## Quick Start

### 1 — Clone / download

```bash
cd ~/Desktop
git clone <repo-url> "GraphRAG POC"
cd "GraphRAG POC"
```

### 2 — Set your API key

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
```

Everything else has working defaults that match the docker-compose services.

### 3 — Install Tesseract (for scanned PDFs)

```bash
brew install tesseract   # macOS
# or: sudo apt-get install tesseract-ocr
```

### 4 — Start all backing services

```bash
docker compose up -d
```

This starts **Neo4j**, **Qdrant**, and **PostgreSQL** in one command. Wait ~20 seconds, then verify:

```bash
docker compose ps   # all three should show "healthy" or "running"
```

> **Neo4j browser** is at http://localhost:7474 (user: `neo4j`, password: `password`).

### 5 — Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

> First run downloads the BGE-M3 model (~2 GB). This happens once and is cached by Hugging Face.

### 6 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 7 — Start both servers

**Terminal 1 — API:**
```bash
./start_api.sh
# → http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
./start_frontend.sh
# → http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## Configuration Reference

All settings live in `backend/.env`:

```env
# ── OpenAI ──────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-proj-...        # Required
LLM_MODEL=gpt-4o                  # Change to gpt-4o-mini to reduce cost

# ── Neo4j ───────────────────────────────────────────────────────────────────
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password           # Must match docker-compose.yml NEO4J_AUTH
NEO4J_DATABASE=neo4j

# ── Qdrant ──────────────────────────────────────────────────────────────────
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=graphrag_elements   # Base name — per-workspace: ws_{id}
# QDRANT_API_KEY=                     # Only needed for Qdrant Cloud

# ── PostgreSQL (workspace metadata) ─────────────────────────────────────────
POSTGRES_URL=postgresql://graphrag:graphrag@localhost:5432/graphrag
# Credentials match docker-compose.yml — change all three places if you update them

# ── Embeddings ───────────────────────────────────────────────────────────────
EMBEDDING_MODEL=BAAI/bge-m3       # Change to all-MiniLM-L6-v2 for faster dev
EMBEDDING_DIMENSION=1024          # Must match the model's output dimension

# ── Quality ──────────────────────────────────────────────────────────────────
CONFIDENCE_THRESHOLD=0.5          # Elements + relationships below this are discarded
MAX_TOKENS_EXTRACTION=4000        # GPT-4o output budget per chunk
MAX_CHUNK_CHARS=3000              # Document chunk size fed to GPT-4o
CHUNK_OVERLAP_CHARS=200           # Overlap between consecutive chunks
```

**Development shortcut — faster and cheaper:**

```env
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

`all-MiniLM-L6-v2` is 90 MB vs 2 GB for BGE-M3 — good enough to test extraction logic.

---

## Project Structure

```
GraphRAG POC/
│
├── backend/                          ← All Python (FastAPI + services + graph)
│   ├── api/
│   │   ├── main.py                   ← FastAPI app, CORS, router registration, Postgres init
│   │   ├── deps.py                   ← Singleton/per-workspace service factory + cache
│   │   └── routes/
│   │       ├── workspaces.py         ← CRUD /api/workspaces (Postgres-backed)
│   │       ├── pipeline.py           ← POST /api/workspaces/{id}/pipeline/run  (SSE)
│   │       ├── graph.py              ← GET  /api/workspaces/{id}/graph/*
│   │       ├── traceability.py       ← GET  /api/workspaces/{id}/traceability/*
│   │       ├── chat.py               ← POST /api/workspaces/{id}/chat/ask
│   │       └── status.py             ← GET/POST /api/workspaces/{id}/status|reset|elements
│   │
│   ├── config/
│   │   └── settings.py               ← All env vars as a frozen dataclass
│   │
│   ├── db/
│   │   └── postgres.py               ← Workspace CRUD (psycopg2, sync, wrapped in to_thread)
│   │                                    init_db, list_workspaces, get_workspace,
│   │                                    create_workspace, update_workspace, delete_workspace
│   │
│   ├── core/                         ← Pure domain — no I/O, no framework deps
│   │   ├── models.py                 ← AtomicElement, Relationship, ParsedDocument, CoverageResult
│   │   ├── interfaces.py             ← IParser, IExtractor, IGraphStore, IVectorStore (ABCs)
│   │   └── exceptions.py             ← Typed exception hierarchy
│   │
│   ├── parsers/
│   │   ├── pdf_parser.py             ← Two-pass: native PyMuPDF → Tesseract OCR fallback
│   │   └── docx_parser.py
│   │
│   ├── extractors/
│   │   └── llm_extractor.py          ← Section-aware chunking → GPT-4o extraction
│   │
│   ├── graph/
│   │   ├── neo4j_store.py            ← IGraphStore; composite (id, workspace_id) constraint
│   │   ├── builder.py                ← GraphBuilder: build, assess_coverage, traceability chain
│   │   └── visualizer.py             ← Legacy PyVis generator (unused in React UI)
│   │
│   ├── vector/
│   │   ├── embedder.py               ← BGEEmbedder singleton (lazy-loads BAAI/bge-m3)
│   │   └── qdrant_store.py           ← Per-workspace collection (ws_{workspace_id})
│   │
│   ├── services/
│   │   ├── document_service.py       ← parse + extract + coordinator cross-doc rels
│   │   ├── graph_service.py          ← Workspace-scoped Neo4j + Qdrant orchestration
│   │   └── qa_service.py             ← Intent detection → evidence → GPT-4o synthesis
│   │
│   ├── requirements.txt
│   ├── .env                          ← Secrets (gitignored — copy from .env.example)
│   └── .env.example
│
├── frontend/                         ← React + Vite + TypeScript
│   ├── src/
│   │   ├── main.tsx                  ← BrowserRouter wrapper
│   │   ├── App.tsx                   ← Route definitions only (React Router v7)
│   │   ├── types.ts                  ← Shared TypeScript types
│   │   ├── index.css                 ← Tailwind + custom dark theme
│   │   ├── api/
│   │   │   └── client.ts             ← fetch wrappers + SSE reader; all calls take workspaceId
│   │   ├── pages/
│   │   │   ├── WorkspacesPage.tsx    ← / → workspace grid, create, delete
│   │   │   └── WorkspacePage.tsx     ← /workspace/:id → full analysis app (keep-alive tabs)
│   │   └── components/
│   │       ├── WorkflowPanel.tsx     ← Dropzone + pipeline SSE trigger
│   │       ├── KnowledgeGraph.tsx    ← React Flow + d3-force, custom nodes, edge highlighting
│   │       ├── ElementsTable.tsx     ← Filterable/sortable elements table
│   │       ├── TraceabilityView.tsx  ← 4-column card layout with inter/intra badges
│   │       └── ChatWindow.tsx        ← Floating chat + evidence source cards (collapsible)
│   ├── package.json
│   └── vite.config.ts                ← Proxies /api → localhost:8000
│
├── Data_Samples/                     ← Sample procurement documents for testing
├── .venv/                            ← Python virtual environment (gitignored)
├── .gitignore
├── docker-compose.yml                ← Neo4j 5.x + Qdrant + PostgreSQL 16
├── start_api.sh                      ← cd backend && uvicorn api.main:app
└── start_frontend.sh                 ← cd frontend && npm run dev
```

---

## UI Walkthrough

### Workspace grid (`/`)

The app opens to a card grid of all your workspaces (stored in PostgreSQL). From here you can:

- **Create workspace** — name + optional description → creates an isolated Neo4j/Qdrant scope
- **Open workspace** — click any card to enter that workspace's analysis environment
- **Delete workspace** — confirm dialog; removes all Neo4j nodes, Qdrant collection, and Postgres row for that workspace

### Workspace app (`/workspace/:id`)

Five tabs — Ingest · Elements · Graph · Traceability · Chat. Tabs are kept alive (CSS show/hide, not remount) so switching tabs doesn't reload the graph or lose chat history. The URL updates to `/workspace/:id/:tab` so deep links and back/forward work correctly.

A **Back** button returns to the workspace grid without losing any data.

#### Ingest tab

Drop PDF or DOCX files. Name them with keywords for automatic document-type detection:

| Filename keyword | Detected as |
|-----------------|-------------|
| `rfp`, `rfx`, `tender` | RFP → extracts `Requirement` nodes |
| `risk`, `rmc`, `register` | Risk Sheet → extracts `Risk` + `Mitigation` |
| `contract`, `offer`, `agreement` | Contract → extracts `Clause` + `LD` |

Click **Run Pipeline**. The five steps stream live. Re-uploading the same file is safe — SHA-256 dedup skips it silently.

#### Elements tab

Filterable table of all extracted elements in this workspace. Filter by type pill, search by text, sort any column, expand a row for full content.

#### Graph tab

Interactive knowledge graph powered by **React Flow + d3-force**:

| Node colour | Element type |
|------------|-------------|
| Indigo | Requirement |
| Emerald | Clause |
| Red | Risk |
| Amber | Mitigation |
| Purple | LD (Liquidated Damages) |
| Slate | Document |

- **Click** a node to highlight its connected edges and show a detail panel
- **Double-click** a node to expand its 1-hop neighbourhood
- **Force / Hierarchy** toggle switches between d3-force and dagre LR layout
- **CONTAINS** toggle: show/hide Document→Element containment edges

#### Traceability tab

Left panel lists every Requirement with its coverage badge. Click a requirement to open its breakdown across four columns — Clauses · Risks · Mitigations · LDs — with **INTER** (cross-document) and **INTRA** (same-document) badges per element.

#### Chat

Floating bubble (bottom-right). Intent-aware Q&A using Cypher graph traversal + BGE-M3 semantic search. Each answer shows the query strategy used and collapsible source cards.

---

## Continuing Development

### Adding a new parser (e.g. Excel)

1. Create `backend/parsers/excel_parser.py` implementing `IParser` from `core/interfaces.py`
2. Register it in `backend/parsers/__init__.py` inside `ParserFactory._parsers`

### Adding a new element type

1. Add the value to `ElementType` in `backend/core/models.py`
2. Update the extraction prompt in `backend/extractors/llm_extractor.py`
3. Add the ID prefix to `prefix_map` in the same file
4. Add the node colour to `TYPE_CONFIG` in `frontend/src/components/KnowledgeGraph.tsx`

### Adding a new Q&A intent

In `backend/services/qa_service.py`:
1. Add keyword detection in `_classify_intent()`
2. Add a `_gather_<intent>_evidence()` method
3. Map the new intent in `answer()`

### Useful debug endpoints

| URL | What it shows |
|-----|--------------|
| http://localhost:7474 | Neo4j Browser — run Cypher directly |
| http://localhost:6333/dashboard | Qdrant dashboard |
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/api/workspaces | List all workspaces |
| http://localhost:8000/api/workspaces/{id}/status | Node/edge counts for a workspace |

**Useful Cypher for Neo4j Browser** (replace `<workspace_id>` with actual ID from Postgres):

```cypher
// All elements in a workspace
MATCH (e:Element {workspace_id: '<workspace_id>'})
RETURN e.id, e.type, e.section ORDER BY e.type

// All semantic edges in a workspace
MATCH (a)-[r]->(b)
WHERE type(r) <> 'CONTAINS' AND a.workspace_id = '<workspace_id>'
RETURN a.id, type(r), b.id, r.confidence ORDER BY type(r)

// Uncovered requirements
MATCH (req:Element {type: 'Requirement', workspace_id: '<workspace_id>'})
WHERE NOT (req)<-[:COVERS]-() AND NOT (req)<-[:PARTIALLY_COVERS]-()
RETURN req.id, req.text, req.section
```

---

## Troubleshooting

### Coverage shows "Not Covered" for everything

1. Open http://localhost:8000/api/workspaces/{id}/status and check edge counts.
2. Check backend logs for `"Found X cross-document relationships"`. If `X = 0`, lower `CONFIDENCE_THRESHOLD=0.4` and re-upload.
3. Use the workspace **Wipe DB** button, then re-upload all documents.

### "Could not initialize PostgreSQL" warning on startup

Docker Compose wasn't started first, or Postgres isn't healthy yet.

```bash
docker compose up -d
docker compose ps   # confirm postgres shows "healthy"
```

### Scanned PDF extracts nothing

Check Tesseract: `tesseract --version`. If not found: `brew install tesseract` (macOS) or `sudo apt-get install tesseract-ocr`.

### "Neo4j: Connection refused"

```bash
docker compose up -d
docker compose logs neo4j
```

Wait ~20 seconds after starting.

### "OPENAI_API_KEY is not set"

```bash
cp backend/.env.example backend/.env
# open backend/.env and set OPENAI_API_KEY=sk-proj-...
```

### BGE-M3 download slow / fails

Switch to a smaller model for development:

```env
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### Frontend can't reach the API

```bash
curl http://localhost:8000/health   # should return {"status":"ok","service":"graphrag-api"}
```

Make sure FastAPI is running. Vite proxies `/api/*` → `localhost:8000`.

### "No Requirements found" in Traceability

Document type is inferred from the filename. Rename the RFP to include `rfp` (e.g. `rfp_project.pdf`), use the workspace **Wipe DB** button, then re-upload.

### Port conflicts

```bash
lsof -i :5432    # Postgres
lsof -i :8000    # FastAPI
lsof -i :7687    # Neo4j Bolt
```

Edit `docker-compose.yml` to remap ports and update `backend/.env` accordingly.

---

## Stopping the Services

```bash
# Stop containers (data preserved in Docker volumes)
docker compose stop

# Full reset — removes containers and volumes (all workspaces deleted)
docker compose down -v
```

---

## Roadmap

- **Clause recommendation** — suggest contract clauses for uncovered requirements
- **Offer generation** — draft a response offer using traced clauses as templates
- **Gap remediation** — auto-suggest mitigations for unmitigated risks
- **Workspace sharing** — invite collaborators to a workspace
