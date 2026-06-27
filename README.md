# GraphRAG POC — Procurement Intelligence

> **Convert procurement documents into a queryable knowledge graph with a professional React UI.**
> Upload RFP + Risk Sheet + Contract → automated pipeline → interactive graph → traceability lineage → natural language Q&A.

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

This POC proves that procurement document intelligence can be fully automated using a production-grade knowledge graph pipeline.

| Input | Output |
|-------|--------|
| RFP / RFX (PDF or DOCX) | Typed `Requirement` nodes |
| Risk Sheet (PDF or DOCX) | Typed `Risk` + `Mitigation` nodes |
| Contract / Offer (PDF or DOCX) | Typed `Clause` + `LD` nodes |

All nodes land in **Neo4j**. Typed edges (`COVERS`, `INTRODUCES_RISK`, `MITIGATED_BY`, `LINKED_TO_LD`, …) connect them across documents. You can then:

- Watch a real-time animated pipeline process your documents step by step
- Explore an interactive knowledge graph with proper nodes and edge labels
- Get a traceability lineage — which requirements are covered, partial, or missing
- Ask natural language questions — answered by graph traversal + semantic search, cited to exact pages

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  React Frontend  (Vite · TypeScript · React Flow)        │
│  localhost:5173                                           │
│                                                          │
│  Upload → Pipeline → Graph → Traceability → Chat         │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP + SSE (streaming)
┌────────────────────────▼─────────────────────────────────┐
│  FastAPI Backend  (uvicorn)                               │
│  localhost:8000                                           │
│                                                          │
│  /api/pipeline/run  (POST, SSE stream)                   │
│  /api/graph/data    (GET)                                │
│  /api/traceability  (GET)                                │
│  /api/chat/ask      (POST)                               │
└───┬──────────────┬──────────────────────────────────────┘
    │              │
┌───▼───┐      ┌───▼──────────────────────────────────────┐
│Neo4j  │      │  Python Services                         │
│:7687  │      │  DocumentService → LLMExtractor → GPT-4o │
└───────┘      │  GraphService    → Neo4j + Qdrant        │
               │  QAService       → Graph + Vector + LLM  │
┌───────┐      └──────────────────────────────────────────┘
│Qdrant │
│:6333  │
└───────┘
```

**Tech stack**

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Vite · React Flow · Tailwind CSS · Framer Motion |
| API | FastAPI · uvicorn · SSE streaming |
| LLM extraction | GPT-4o (OpenAI function calling) |
| Graph store | Neo4j 5.x (Cypher MERGE, typed edges) |
| Graph memory | Graphiti-core (episodic memory on Neo4j) |
| Vector store | Qdrant |
| Embeddings | BAAI/bge-m3 (sentence-transformers, 1024-dim) |

---

## Prerequisites

### System requirements

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| Docker Desktop | 4.x | `docker --version` |

> macOS and Linux tested. Windows works via WSL2 with Docker Desktop.

### API keys

| Service | Where to get it | Required? |
|---------|----------------|-----------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Yes** — GPT-4o for extraction and Q&A |

> GPT-4o costs approximately **$0.01–0.05 per document** depending on length.

### Ports that must be free

| Port | Used by |
|------|--------|
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

Open `backend/.env` and fill in your key:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
```

Everything else has working defaults.

### 3 — Start Neo4j and Qdrant

```bash
docker compose up -d
```

Wait ~20 seconds, then verify:

```bash
docker compose ps   # both should show "healthy" or "running"
```

> **Neo4j browser** is at http://localhost:7474 (user: `neo4j`, password: `password`).

### 4 — Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

> First run downloads the BGE-M3 model (~2 GB). This happens once and is cached by Hugging Face.

### 5 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 6 — Start both servers

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
QDRANT_COLLECTION=graphrag_elements
# QDRANT_API_KEY=                 # Only needed for Qdrant Cloud

# ── Embeddings ───────────────────────────────────────────────────────────────
EMBEDDING_MODEL=BAAI/bge-m3       # Change to all-MiniLM-L6-v2 for faster dev
EMBEDDING_DIMENSION=1024          # Must match the model's output dimension

# ── Quality ──────────────────────────────────────────────────────────────────
CONFIDENCE_THRESHOLD=0.6          # Elements below this are discarded
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
├── backend/                        ← All Python (FastAPI + services + graph)
│   ├── api/
│   │   ├── main.py                 ← FastAPI app, CORS, router registration
│   │   ├── deps.py                 ← Singleton service instances
│   │   └── routes/
│   │       ├── pipeline.py         ← POST /api/pipeline/run  (SSE stream)
│   │       ├── graph.py            ← GET  /api/graph/data|subgraph|stats
│   │       ├── traceability.py     ← GET  /api/traceability/coverage|chain
│   │       ├── chat.py             ← POST /api/chat/ask
│   │       └── status.py           ← GET/POST /api/status|reset|elements
│   │
│   ├── config/
│   │   └── settings.py             ← All env vars as a frozen dataclass
│   │
│   ├── core/                       ← Pure domain — no I/O, no framework deps
│   │   ├── models.py               ← AtomicElement, Relationship, ParsedDocument, CoverageResult
│   │   ├── interfaces.py           ← IParser, IExtractor, IGraphStore, IVectorStore (ABCs)
│   │   └── exceptions.py           ← Typed exception hierarchy
│   │
│   ├── parsers/                    ← Text extraction only
│   │   ├── pdf_parser.py           ← PyMuPDF
│   │   └── docx_parser.py          ← python-docx
│   │
│   ├── extractors/
│   │   └── llm_extractor.py        ← GPT-4o function calling → AtomicElement + Relationship
│   │
│   ├── graph/
│   │   ├── neo4j_store.py          ← IGraphStore on Neo4j (Cypher MERGE / MATCH)
│   │   ├── graphiti_memory.py      ← Graphiti episodic memory (async + sync wrappers)
│   │   ├── builder.py              ← GraphBuilder: build, assess_coverage, traceability
│   │   └── visualizer.py           ← Legacy PyVis generator (used by old Streamlit UI)
│   │
│   ├── vector/
│   │   ├── embedder.py             ← BGEEmbedder (lazy-loads BAAI/bge-m3)
│   │   └── qdrant_store.py         ← IVectorStore on Qdrant
│   │
│   ├── services/                   ← Orchestration — the only layer the API talks to
│   │   ├── document_service.py     ← parse + extract + SHA-256 dedup
│   │   ├── graph_service.py        ← Neo4j + Qdrant + Graphiti build pipeline
│   │   └── qa_service.py           ← intent detection → evidence → GPT-4o synthesis
│   │
│   ├── ui/                         ← Legacy Streamlit UI (kept, not default)
│   ├── app.py                      ← Legacy Streamlit entry point
│   ├── requirements.txt
│   ├── .env                        ← Secrets (gitignored — copy from .env.example)
│   └── .env.example
│
├── frontend/                       ← React + Vite + TypeScript
│   ├── src/
│   │   ├── App.tsx                 ← Tab navigation, global state, header
│   │   ├── types.ts                ← Shared TypeScript types
│   │   ├── index.css               ← Tailwind + custom dark theme
│   │   ├── api/
│   │   │   └── client.ts           ← fetch wrappers + SSE stream reader
│   │   └── components/
│   │       ├── UploadZone.tsx      ← Dropzone + pipeline trigger
│   │       ├── PipelineProgress.tsx← Animated step cards with live progress bars
│   │       ├── KnowledgeGraph.tsx  ← React Flow graph (dagre layout, custom nodes)
│   │       ├── ElementsTable.tsx   ← Filterable/sortable elements table
│   │       ├── TraceabilityView.tsx← Coverage metrics + React Flow lineage diagram
│   │       └── ChatWindow.tsx      ← Floating chat bubble + conversation panel
│   ├── package.json
│   └── vite.config.ts              ← Proxies /api → localhost:8000
│
├── .venv/                          ← Python virtual environment (gitignored)
├── .gitignore
├── docker-compose.yml              ← Neo4j 5.x + Qdrant
├── start_api.sh                    ← cd backend && uvicorn api.main:app
├── start_frontend.sh               ← cd frontend && npm run dev
└── TECHNICAL_GUIDE.md              ← In-depth technical documentation
```

---

## UI Walkthrough

### Upload tab

Drop PDF or DOCX files. Name them with keywords for automatic document-type detection:

| Filename keyword | Detected as |
|-----------------|-------------|
| `rfp`, `rfx`, `tender` | RFP → extracts `Requirement` nodes |
| `risk`, `rmc`, `register` | Risk Sheet → extracts `Risk` + `Mitigation` |
| `contract`, `offer`, `agreement` | Contract → extracts `Clause` + `LD` |

Click **Run Pipeline**. The five steps stream live:

| Step | What happens |
|------|-------------|
| 📄 Parse Documents | Text extracted from PDF/DOCX page by page |
| 🔍 Extract Elements (LLM) | GPT-4o reads each chunk and calls a typed function schema |
| 🕸️ Build Knowledge Graph | Nodes + edges written to Neo4j with `MERGE` semantics |
| 🔢 Index Semantic Vectors | BGE-M3 embeddings upserted to Qdrant |
| 📊 Assess Coverage | Coverage verdict computed per Requirement via graph traversal |

Re-uploading the same file is safe — SHA-256 hash dedup skips it silently.

### Elements tab

Filterable table of all extracted elements. Filter by type pill, search by text, sort any column, expand a row for full content.

### Graph tab

Interactive knowledge graph powered by **React Flow**:

| Node colour | Element type |
|------------|-------------|
| Indigo | Requirement |
| Emerald | Clause |
| Red | Risk |
| Amber | Mitigation |
| Purple | LD (Liquidated Damages) |

Edges carry labels (`COVERS`, `PARTIALLY_COVERS`, `INTRODUCES_RISK`, …). Click any node for a detail panel. Type a node ID in the **Subgraph Explorer** to zoom into its 1-hop neighbourhood.

### Traceability tab

Left panel lists every Requirement with its coverage status badge and clause/risk counts. Click a requirement to render its full **lineage diagram**:

```
[Requirement] ──COVERS──► [Clause]
              ──RISK──►   [Risk] ──MITIGATED BY──► [Mitigation]
                                 ──LINKED TO LD──► [LD]
```

Identified gaps are highlighted below the diagram.

### Chat (floating bubble, bottom-right)

Ask anything in plain English. The backend classifies intent and picks the right evidence strategy:

| Question pattern | Strategy |
|-----------------|---------|
| "not covered", "gap", "missing coverage" | Cypher traversal → uncovered Requirements |
| "risk" + "partial" | Cypher traversal → risks on partially-covered Requirements |
| "no mitigation", "unmitigated" | Graph traversal → Risks without MITIGATED_BY edge |
| "no ld", "no penalty" | Graph traversal → Risks without LINKED_TO_LD edge |
| Everything else | BGE-M3 vector search + Graphiti entity search + GPT-4o synthesis |

Each answer shows a **query type tag** so you know which strategy was used.

---

## Continuing Development

### Adding a new parser (e.g. Excel)

1. Create `backend/parsers/excel_parser.py` implementing `IParser` from `core/interfaces.py`
2. Register it in `backend/parsers/__init__.py` inside `ParserFactory._parsers`

No other files need to change.

### Adding a new element type

1. Add the value to `ElementType` in `backend/core/models.py`
2. Update the extraction prompt in `backend/extractors/llm_extractor.py`
3. Add the ID prefix and type-to-enum mapping in the same file
4. Add the node colour in `frontend/src/components/KnowledgeGraph.tsx` (`TYPE_CONFIG`)

### Adding a new Q&A intent

In `backend/services/qa_service.py`:
1. Add keyword detection in `_classify_intent()`
2. Add a `_gather_<intent>_evidence()` method
3. Map the new intent in `answer()`

In `frontend/src/components/ChatWindow.tsx` add the label to `QUERY_TYPE_LABELS`.

### Swapping Neo4j for another graph store

1. Create `backend/graph/your_store.py` implementing `IGraphStore` from `core/interfaces.py`
2. Swap the import in `backend/graph/__init__.py`
3. Change `Neo4jGraphStore()` to `YourStore()` in `backend/services/graph_service.py`

### Useful debug endpoints

| URL | What it shows |
|-----|--------------|
| http://localhost:7474 | Neo4j Browser — run Cypher directly |
| http://localhost:6333/dashboard | Qdrant dashboard |
| http://localhost:8000/docs | FastAPI auto-generated Swagger UI |
| http://localhost:8000/api/status | Current graph node/edge counts |

**Useful Cypher for Neo4j Browser:**

```cypher
-- All nodes and relationships
MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50

-- Count by type
MATCH (e:Element) RETURN e.type, count(e) ORDER BY count(e) DESC

-- Trace a requirement
MATCH path = (req:Element {id: 'REQ_001'})-[*1..3]-(related)
RETURN path

-- Uncovered requirements
MATCH (req:Element {type: 'Requirement'})
WHERE NOT (req)<-[:COVERS]-() AND NOT (req)<-[:PARTIALLY_COVERS]-()
RETURN req.id, req.text
```

---

## Troubleshooting

### "Neo4j: Connection refused"

```bash
docker compose ps          # check status
docker compose logs neo4j  # check for errors
docker compose up -d       # restart
```

Wait ~20 seconds after starting.

### "OPENAI_API_KEY is not set"

```bash
cp backend/.env.example backend/.env
# then open backend/.env and set OPENAI_API_KEY=sk-proj-...
```

### BGE-M3 download slow / fails

```bash
# Pre-download manually
.venv/bin/python3 -c "
from sentence_transformers import SentenceTransformer
SentenceTransformer('BAAI/bge-m3')
"
```

Or switch to a smaller model in `backend/.env`:

```env
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### Frontend can't reach the API

Make sure the FastAPI server is running on port 8000. The Vite dev server proxies `/api/*` → `localhost:8000` automatically (see `frontend/vite.config.ts`).

```bash
curl http://localhost:8000/health   # should return {"status":"ok"}
```

### "No Requirements found" in Traceability

The document type is inferred from the filename. If your RFP file isn't named with `rfp`, `rfx`, or `tender`, GPT-4o extracts Clauses instead of Requirements.

Fix: rename the file (e.g. `rfp_project.pdf`), use **Wipe DB** in the header, then re-upload.

### Port conflicts

```bash
lsof -i :8000    # find what's using the API port
lsof -i :7687    # find what's using Neo4j Bolt
```

Edit `docker-compose.yml` to remap ports and update `backend/.env` accordingly.

---

## Stopping the Services

```bash
# Stop containers (data preserved in Docker volumes)
docker compose stop

# Full reset — removes containers and volumes
docker compose down -v
```

---

## Phase 2 — Planned

The current POC covers knowledge extraction and coverage assessment. Phase 2 will add:

- **Clause recommendation** — suggest contract clauses for uncovered requirements
- **Offer generation** — draft a response offer using traced clauses as templates
- **Gap remediation** — auto-suggest mitigations for unmitigated risks

These build directly on the graph constructed in Phase 1.
