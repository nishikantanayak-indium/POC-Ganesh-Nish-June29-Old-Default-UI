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
- Explore an interactive force-directed knowledge graph — drag nodes freely, zoom, expand neighbourhoods
- Get a traceability lineage — which requirements are covered, partial, or missing, with inter-document vs intra-document badges
- Ask natural language questions — answered by graph traversal + semantic search, cited to exact sections

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React Frontend  (Vite · TypeScript · React Flow · d3-force) │
│  localhost:5173                                               │
│                                                               │
│  Landing → Upload → Graph → Traceability → Chat              │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP + SSE (streaming)
┌────────────────────────▼─────────────────────────────────────┐
│  FastAPI Backend  (uvicorn · localhost:8000)                  │
│                                                               │
│  POST /api/pipeline/run    — SSE streaming pipeline (5 steps)│
│  GET  /api/graph/data      — React Flow nodes + edges        │
│  GET  /api/graph/subgraph  — 1-hop neighbourhood expand      │
│  GET  /api/traceability/*  — coverage + chain                │
│  POST /api/chat/ask        — intent-aware Q&A                │
│  GET  /api/elements        — all elements (for preload)      │
│  GET  /api/debug/edges     — edge diagnostics by type        │
└───┬──────────────┬──────────────────────────────────────────-┘
    │              │
┌───▼───┐      ┌───▼──────────────────────────────────────────┐
│Neo4j  │      │  Python Services                             │
│:7687  │      │  DocumentService  → PDFParser/DOCXParser     │
└───────┘      │                     → LLMExtractor → GPT-4o  │
               │  GraphService     → Neo4j + Qdrant           │
┌───────┐      │  QAService        → Graph + Vector + LLM     │
│Qdrant │      └──────────────────────────────────────────────┘
│:6333  │
└───────┘
```

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

3  Build Graph    Cross-document relationship extraction (second LLM call, all elements)
                  → COVERS / PARTIALLY_COVERS / INTRODUCES_RISK /
                     MITIGATED_BY / LINKED_TO_LD / CONTRADICTS
                  Written into Neo4j with Cypher MERGE (idempotent)
                  Elements stored with section as top-level indexed Neo4j property

4  Index Vectors  BGE-M3 embeddings of all elements → Qdrant
                  Payload includes: section, page_number — enables section-scoped search
                  Powers semantic Q&A retrieval

5  Coverage       Graph traversal per Requirement
                  → Covered / Partially Covered / Not Covered
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Vite · React Flow v12 · d3-force · Tailwind CSS · Framer Motion |
| API | FastAPI · uvicorn · SSE streaming |
| LLM extraction | GPT-4o (OpenAI function calling — structured output) |
| Graph store | Neo4j 5.x (Cypher MERGE, typed edges, uniqueness constraints, section index) |
| Vector store | Qdrant (section + page_number in payload) |
| Embeddings | BAAI/bge-m3 (sentence-transformers, 1024-dim) |
| OCR | Tesseract 5.x + pytesseract + PyMuPDF rendering (scanned PDF fallback) |

> **Graphiti has been removed from the active pipeline.** The `graphiti_memory.py` module is kept in the codebase for reference but is not called during document ingestion. It added 30–120 seconds per document (GPT-4o on every page) with no benefit to coverage or traceability queries.

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

# Windows (WSL2)
sudo apt-get install tesseract-ocr
```

> Tesseract is only needed if you upload scanned PDFs (image-based, no embedded text layer). Digital PDFs and DOCX files work without it.

> macOS and Linux tested. Windows works via WSL2 with Docker Desktop.

### API keys

| Service | Where to get it | Required? |
|---------|----------------|-----------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Yes** — GPT-4o for extraction and Q&A |

> GPT-4o costs approximately **$0.02–0.15 per document** (element extraction + cross-document relationship extraction). Scanned PDFs with many pages produce more chunks and cost slightly more.

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

Open `backend/.env` and fill in:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
```

Everything else has working defaults.

### 3 — Install Tesseract (for scanned PDFs)

```bash
brew install tesseract   # macOS
# or: sudo apt-get install tesseract-ocr
```

### 4 — Start Neo4j and Qdrant

```bash
docker compose up -d
```

Wait ~20 seconds, then verify:

```bash
docker compose ps   # both should show "healthy" or "running"
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
QDRANT_COLLECTION=graphrag_elements
# QDRANT_API_KEY=                 # Only needed for Qdrant Cloud

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
├── backend/                        ← All Python (FastAPI + services + graph)
│   ├── api/
│   │   ├── main.py                 ← FastAPI app, CORS, router registration
│   │   ├── deps.py                 ← Singleton service instances
│   │   └── routes/
│   │       ├── pipeline.py         ← POST /api/pipeline/run  (SSE stream, 5 steps)
│   │       ├── graph.py            ← GET  /api/graph/data|subgraph|stats
│   │       ├── traceability.py     ← GET  /api/traceability/coverage|chain
│   │       ├── chat.py             ← POST /api/chat/ask
│   │       └── status.py           ← GET/POST /api/status|reset|elements|debug/edges
│   │
│   ├── config/
│   │   └── settings.py             ← All env vars as a frozen dataclass
│   │
│   ├── core/                       ← Pure domain — no I/O, no framework deps
│   │   ├── models.py               ← AtomicElement, Relationship, ParsedDocument, CoverageResult
│   │   │                              AtomicElement.metadata carries section + page_number
│   │   ├── interfaces.py           ← IParser, IExtractor, IGraphStore, IVectorStore (ABCs)
│   │   └── exceptions.py           ← Typed exception hierarchy
│   │
│   ├── parsers/                    ← Text extraction only
│   │   ├── pdf_parser.py           ← Two-pass: native PyMuPDF text → Tesseract OCR fallback
│   │   │                              Non-ASCII ratio filter drops garbled CJK pages
│   │   └── docx_parser.py          ← python-docx
│   │
│   ├── extractors/
│   │   └── llm_extractor.py        ← Section-aware chunking (_chunk_pages)
│   │                                  Detects Section X / 3.1.2 / APPENDIX A / GCC 6.1 headers
│   │                                  Prefixes chunks with [Section | Page N] for LLM context
│   │                                  GPT-4o function calling → AtomicElement + Relationship
│   │                                  Two passes: per-doc element extraction, then cross-doc rels
│   │
│   ├── graph/
│   │   ├── neo4j_store.py          ← IGraphStore on Neo4j (Cypher MERGE / MATCH)
│   │   │                              section stored as top-level indexed property
│   │   ├── graphiti_memory.py      ← Graphiti episodic memory (unused — kept for reference)
│   │   ├── builder.py              ← GraphBuilder: build, assess_coverage, traceability chain
│   │   └── visualizer.py           ← Legacy PyVis generator (unused in React UI)
│   │
│   ├── vector/
│   │   ├── embedder.py             ← BGEEmbedder (lazy-loads BAAI/bge-m3)
│   │   └── qdrant_store.py         ← IVectorStore on Qdrant
│   │                                  Payload includes: section, page_number
│   │                                  search_by_type accepts optional section= filter
│   │
│   ├── services/                   ← Orchestration — the only layer the API talks to
│   │   ├── document_service.py     ← parse + per-doc extract + cross-doc relationship extraction
│   │   ├── graph_service.py        ← Neo4j + Qdrant build pipeline
│   │   └── qa_service.py           ← intent detection → evidence → GPT-4o synthesis
│   │
│   ├── requirements.txt            ← Includes pytesseract + Pillow for OCR
│   ├── .env                        ← Secrets (gitignored — copy from .env.example)
│   └── .env.example
│
├── frontend/                       ← React + Vite + TypeScript
│   ├── src/
│   │   ├── App.tsx                 ← Tab navigation, global state, preload on resume
│   │   ├── types.ts                ← Shared TypeScript types incl. ChainElement, EvidenceItem
│   │   ├── index.css               ← Tailwind + custom dark theme
│   │   ├── api/
│   │   │   └── client.ts           ← fetch wrappers + SSE stream reader
│   │   └── components/
│   │       ├── LandingPage.tsx     ← Full-screen landing: Launch / Resume Session
│   │       ├── UploadZone.tsx      ← Dropzone + pipeline SSE trigger
│   │       ├── PipelineProgress.tsx← Animated step cards with live progress bars
│   │       ├── KnowledgeGraph.tsx  ← React Flow + d3-force layout, custom nodes, edge highlighting
│   │       ├── ElementsTable.tsx   ← Filterable/sortable elements table
│   │       ├── TraceabilityView.tsx← 4-column card layout with inter/intra document badges
│   │       └── ChatWindow.tsx      ← Floating chat + evidence source cards (collapsible)
│   ├── package.json
│   └── vite.config.ts              ← Proxies /api → localhost:8000
│
├── Data_Samples/                   ← Sample procurement documents for testing
├── .venv/                          ← Python virtual environment (gitignored)
├── .gitignore
├── docker-compose.yml              ← Neo4j 5.x + Qdrant
├── start_api.sh                    ← cd backend && uvicorn api.main:app
└── start_frontend.sh               ← cd frontend && npm run dev
```

---

## UI Walkthrough

### Landing page

Opening the app shows a full-screen landing page. Two states:

- **No data** — "Launch App →" button, feature overview
- **Data present** — "Resume Session →" with live node/edge/type counts and a green dot. Graph tab loads automatically on resume.

Click the logo in the header at any time to return to the landing page.

### Upload tab

Drop PDF or DOCX files. Name them with keywords for automatic document-type detection:

| Filename keyword | Detected as |
|-----------------|-------------|
| `rfp`, `rfx`, `tender` | RFP → extracts `Requirement` nodes |
| `risk`, `rmc`, `register` | Risk Sheet → extracts `Risk` + `Mitigation` |
| `contract`, `offer`, `agreement` | Contract → extracts `Clause` + `LD` |

Click **Run Pipeline**. The five steps stream live with progress messages:

| Step | What happens |
|------|-------------|
| 📄 Parse Documents | SHA-256 dedup skips unchanged files. Digital PDFs extract natively; **scanned PDFs are OCR'd with Tesseract** (page-by-page, ~0.5–1s per page). |
| 🔍 Extract Elements (LLM) | Section headers detected per page → chunks prefixed with section context → GPT-4o extracts elements with accurate section + page attribution. IDs prefixed per doc (`RFP1_REQ_001`). |
| 🕸️ Build Knowledge Graph | Second LLM call sends all elements together → infers cross-document relationships → written to Neo4j with `section` as an indexed property. |
| 🔢 Index Semantic Vectors | BGE-M3 embeddings upserted to Qdrant. Payload includes `section` and `page_number` for future section-scoped queries. |
| 📊 Assess Coverage | Graph traversal per Requirement → Covered / Partially Covered / Not Covered. |

Re-uploading the same file is safe — the SHA-256 hash check skips it silently.

### Elements tab

Filterable table of all extracted elements. Filter by type pill, search by text, sort any column, expand a row for full content.

### Graph tab

Interactive knowledge graph powered by **React Flow + d3-force**:

| Node colour | Element type |
|------------|-------------|
| Indigo | Requirement |
| Emerald | Clause |
| Red | Risk |
| Amber | Mitigation |
| Purple | LD (Liquidated Damages) |
| Slate | Document |

**Controls:**
- **Drag** nodes freely to rearrange
- **Scroll** to zoom in/out
- **Click** a node to highlight its connected edges (others dim to 10% opacity) and show a detail panel
- **Double-click** a node to expand its 1-hop neighbourhood into the current view
- **Force / Hierarchy** toggle in toolbar switches between d3-force (organic) and dagre LR (structured) layout
- **Explore** input: type any node ID to load just its subgraph
- **CONTAINS** toggle: show/hide Document→Element containment edges
- **Refresh** button: re-runs the current layout from scratch

### Traceability tab

Left panel lists every Requirement with its coverage badge (Covered / Partial / Not Covered) and counts of linked clauses and risks. Click a requirement to open its traceability breakdown:

**Four columns** — Clauses · Risks · Mitigations · LDs

Each card shows:
- Element ID and type badge
- Text preview (click to expand full text)
- Relationship label (`COVERS`, `INTRODUCES_RISK`, etc.)
- **↔ INTER** badge (blue) — element is from a different document than the requirement
- **↕ INTRA** badge (slate) — element is from the same document
- Source reference in small monospace (now shows exact section, e.g. `Section 5. Terms of Reference`)

Below the columns: inter-document vs intra-document summary counts, and a red gap alert if any risks have no mitigation or no LD.

### Chat (floating bubble, bottom-right)

Ask anything in plain English. The backend classifies intent and picks the right evidence strategy:

| Question pattern | Strategy |
|-----------------|---------|
| "not covered", "gap", "missing coverage" | Cypher traversal → uncovered Requirements |
| "risk" + "partial" | Cypher traversal → risks on partially-covered Requirements |
| "no mitigation", "unmitigated" | Graph traversal → Risks without MITIGATED_BY edge |
| "no ld", "no penalty" | Graph traversal → Risks without LINKED_TO_LD edge |
| Everything else | BGE-M3 vector search → relevant elements → GPT-4o synthesis |

Each answer shows:
- **Query type tag** — which strategy was used
- **Concise prose answer** — 2–4 sentences, no inline element IDs
- **Collapsible source cards** — numbered, coloured by element type, shows section + source reference

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

In `frontend/src/components/ChatWindow.tsx` add the label to `QUERY_TYPE`.

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
| http://localhost:8000/api/debug/edges | All edges grouped by relationship type — diagnose if COVERS/INTRODUCES_RISK etc. are being written |

**Useful Cypher for Neo4j Browser:**

```cypher
// All semantic edges (excludes CONTAINS)
MATCH (a)-[r]->(b)
WHERE type(r) <> 'CONTAINS'
RETURN a.id, type(r), b.id, r.confidence
ORDER BY type(r)

// Count edges by type
MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS n ORDER BY n DESC

// Elements by section (new — section is now an indexed property)
MATCH (e:Element {section: 'Section 5. Terms of Reference'})
RETURN e.id, e.type, e.text
ORDER BY e.type

// Trace a requirement — adjust ID to match actual prefixed format
MATCH path = (req:Element {id: 'RFP1_REQ_001'})-[*1..3]-(related)
RETURN path

// Uncovered requirements
MATCH (req:Element {type: 'Requirement'})
WHERE NOT (req)<-[:COVERS]-() AND NOT (req)<-[:PARTIALLY_COVERS]-()
RETURN req.id, req.text, req.section
```

---

## Troubleshooting

### Coverage shows "Not Covered" for everything

The cross-document relationship extraction runs as the second LLM call inside the "Build Knowledge Graph" step. Check:

1. **Confirm edges exist** — open http://localhost:8000/api/debug/edges and look for `COVERS` in the summary. If the summary only shows `CONTAINS`, relationships aren't being generated.

2. **Check the backend logs** — look for `"Found X cross-document relationships"`. If `X = 0`, the LLM isn't generating any above the confidence threshold.

3. **Lower the threshold** — in `backend/.env` set `CONFIDENCE_THRESHOLD=0.4` and re-run after resetting.

4. **Reset and re-upload** — hit the **Wipe DB** button in the header (or `POST /api/reset`), then re-upload all documents. The graph is rebuilt from scratch each run.

5. **Check element IDs** — element IDs are now doc-prefixed (`RFP1_REQ_001`, `CONT_CL_001`). If old IDs without prefixes are in Neo4j from a previous run, reset the graph first.

### Scanned PDF extracts nothing

1. **Check Tesseract is installed:**
   ```bash
   tesseract --version
   ```
   If not found: `brew install tesseract` (macOS) or `sudo apt-get install tesseract-ocr`.

2. **Check backend logs** for lines like:
   ```
   Parsed 'rfp.pdf': 146 pages (146 via OCR, 0 skipped)
   ```
   If `total_pages = 0`, Tesseract isn't being called or all pages are being filtered.

3. **High non-ASCII ratio filter** — pages where > 40% of OCR output is non-ASCII are dropped. This catches garbled CJK pages but may also drop pages with many special characters. Adjust `non_ascii_threshold` in `PDFParser.__init__` if needed.

4. **Performance** — Tesseract OCR runs at ~0.5–1s per page. A 146-page document takes ~2 minutes to OCR. This happens during the "Extract Elements" step.

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
.venv/bin/python3 -c "
from sentence_transformers import SentenceTransformer
SentenceTransformer('BAAI/bge-m3')
"
```

Or switch to a smaller model:

```env
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### Frontend can't reach the API

Make sure FastAPI is running on port 8000. Vite proxies `/api/*` → `localhost:8000` (see `frontend/vite.config.ts`).

```bash
curl http://localhost:8000/health   # should return {"status":"ok"}
```

### "No Requirements found" in Traceability

Document type is inferred from the filename. If your RFP isn't named with `rfp`, `rfx`, or `tender`, GPT-4o extracts Clauses instead of Requirements.

Fix: rename the file (e.g. `rfp_project.pdf`), click **Wipe DB**, then re-upload.

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
