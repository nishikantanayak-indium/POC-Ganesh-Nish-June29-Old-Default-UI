# ContractIQ — Contract Intelligence Platform

> **Two capabilities, one platform.**
> - **Analysis** — upload RFPs, risk sheets & contracts → automated SSE-streaming pipeline → interactive knowledge graph → traceability lineage → natural-language Q&A.
> - **Synthetic Data Studio** — generate, validate, quality-check & SME-review synthetic contract artifacts, then publish balanced, versioned datasets straight into Analysis.

The two areas are co-equal entry points from the landing page and share the same document domain (RFP / Risk Sheet / Contract; Requirement / Clause / Risk / Mitigation / LD), so a Studio dataset drops into the Analysis graph with no translation layer.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Synthetic Data Studio](#synthetic-data-studio)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Quick Start](#quick-start)
6. [Configuration Reference](#configuration-reference)
7. [Project Structure](#project-structure)
8. [UI Walkthrough](#ui-walkthrough)
9. [Extending the System](#extending-the-system)
10. [Troubleshooting](#troubleshooting)

---

## What This Does

The platform lets analysts run multiple independent procurement analyses side-by-side — each in its own workspace with fully isolated graph data, vector indexes, and pipeline state.

| Input | Extracted as |
|-------|-------------|
| RFP / RFX (PDF or DOCX) | `Requirement` nodes |
| Risk Sheet (PDF or DOCX) | `Risk` + `Mitigation` nodes |
| Contract / Offer (PDF or DOCX) | `Clause` + `LD` nodes |

All nodes land in **Neo4j**, scoped to the workspace. Typed edges (`COVERS`, `PARTIALLY_COVERS`, `INTRODUCES_RISK`, `MITIGATED_BY`, `LINKED_TO_LD`, `CONTRADICTS`) connect them across documents. Within each workspace you can:

- Watch a **real-time streaming pipeline** process your documents step by step (SSE)
- Explore an **interactive force-directed / hierarchical knowledge graph** — drag nodes, zoom, expand neighbourhoods
- View **cross-document relationships** in a dedicated sidebar panel with relationship type filtering
- Get a **traceability lineage** — which requirements are covered, partial, or missing, with INTER/INTRA document badges, plus a **contradictions** card surfacing any `CONTRADICTS` edges between clauses
- Ask **natural language questions** — either from a floating chat window or a dedicated, persistent-conversation Chat page — answered by graph traversal + semantic search, cited to exact sections
- Generate a **draft Offer/Proposal** — an evidence-backed, editable response to an ingested RFP, grounded in that workspace's real coverage data, with inline AI-assisted rewriting and export to Markdown/.docx
- **Compare deals across workspaces** — a Table view on the workspace grid showing coverage %, gaps, and contradiction counts side by side

---

## Synthetic Data Studio

The second product area (`/studio`) manufactures training-grade synthetic contract data through four core services, then hands finished datasets to Analysis.

| Core service | Does |
|--------------|------|
| **Generation** | Generates clauses, requirements, risks, mitigations, LDs, labeled relationship/mapping examples, and composite documents (GPT-4o). Intent-led (Describe / Mirror / Balance), honours a free-text **brief**, and can **suggest a taxonomy** from your seed documents. |
| **Validation** | Schema Validity (Pydantic/JSON Schema) · Label Validity (against the project's label set) · Business rules + Coverage Consistency (relationship direction/label). |
| **Quality** | Duplicate detection (BGE-M3 + Qdrant cosine) · Realism (rules + LLM-as-Judge) · Diversity/Balance (distribution + normalised entropy). |
| **Dataset Management** | Immutable versioning, clone-to-edit, delete, lineage, promotion (staging → main), non-destructive publication into an Analysis workspace, and dataset/document export. |

**Categories.** Element types are fixed (Requirement/Clause/Risk/Mitigation/LD — a structural contract with the graph); **taxonomy labels are per-project strings** (7 defaults — `Legal, Financial, Technical, KPI, Risk, Compliance, Liquidated Damages` — add your own like `Insurance`, `Data Privacy`). On seed analysis the AI also **suggests labels from the document content**, adoptable with one click in the Categories editor.

**Generation is intent-led** — you pick a goal, not a grid:
- **Describe** — free-text brief + element types; the model assigns each record the best-fitting label. No seeds required.
- **Mirror a document** — reproduce a specific seed doc's section layout + category composition.
- **Balance coverage** — fill under-threshold cells of the `element types × labels` matrix (target = min examples per cell, default 5).

**Document assembly** is a per-run choice on the Generate tab: **Don't assemble** (records only, no document), **One combined document** (default — every staged record folds into a single Markdown/Word file regardless of document-type mix), or **One document per document type** (opt-in — splits output by `doc_type`). Mirror always produces exactly one document, reproducing the seed's section layout, and ignores this choice.

**Flow.**

```
(optional) upload seeds → AI-suggested categories + coverage
   → choose intent: Describe · Mirror · Balance
   → generate → validate → quality → STAGING
   → SME review (filterable queue; recommended) → promote STAGING → MAIN (immutable)
   → publish into an Analysis workspace (feeds the existing graph pipeline)
```

**Versioning is atomic.** Each generation (and each **clone**) is a version. Promoting to **MAIN freezes** it (SME edits return `409`); to change it, **clone** it into a new editable staging version (records reset to unverified for a fresh review cycle). Publishing is **non-destructive and re-publishable**; versions can be **deleted** (cascades records/relationships/documents + artifacts). Every version is **exportable** — records/relationships as JSONL, each draft document as **Markdown & .docx**, or a **ZIP bundle** with a manifest.

The Studio workspace has five tabs — **Generate · Validate · Quality · SME Review · Datasets** — all bound to the header's current-version selector. **SME Review** is a filterable queue (Unreviewed / Approved / Rejected / All) with a highlighted representative sample; verdicts move records between buckets rather than hiding them, and the Datasets tab shows live per-version review counts.

Structured metadata lives in **PostgreSQL** (`synthetic_*` tables); raw artifacts (records JSONL, rendered documents) live in **MinIO/S3** (`synthetic` bucket, filesystem fallback); duplicate-detection embeddings live in a dedicated **Qdrant** collection (`synthetic_elements`).

> Full implementation reference — services, endpoints, config, and data model — is in **[TECHNICAL_GUIDE.md](TECHNICAL_GUIDE.md) §14**.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  React Frontend  (Vite · TypeScript · React Router v7)               │
│  frontend1/ · localhost:5173                                          │
│                                                                        │
│  /                          → Landing (Analysis · Synthetic Studio)   │
│  /workspaces                        → Workspace grid (Cards/Table)   │
│  /workspace/:id/:tab                → Analysis App                    │
│                          Ingest · Explorer · Graph · Traceability ·   │
│                          Draft (Offer/Proposal generation)            │
│  /workspace/:id/chat                → Persistent-conversation Chat    │
│  /studio, /studio/project/:id/:tab  → Synthetic Data Studio           │
│                          Generate · Validate · Quality · SME · Datasets│
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTP + SSE streaming
┌────────────────────────────▼─────────────────────────────────────────┐
│  FastAPI Backend  (uvicorn · localhost:8000)                          │
│                                                                        │
│  GET/POST /api/workspaces                         Workspace CRUD      │
│  POST /api/workspaces/{id}/pipeline/run           SSE pipeline        │
│  GET  /api/workspaces/{id}/graph/data             React Flow data     │
│  GET  /api/workspaces/{id}/graph/subgraph/:id     1-hop neighbourhood │
│  GET  /api/workspaces/{id}/graph/cross-doc-relationships              │
│  GET  /api/workspaces/{id}/traceability/coverage  Coverage results    │
│  GET  /api/workspaces/{id}/traceability/chain/:id Traceability chain  │
│  GET  /api/workspaces/{id}/traceability/contradictions  CONTRADICTS   │
│  POST /api/workspaces/{id}/chat/ask               Intent-aware Q&A   │
│  GET/POST /api/workspaces/{id}/chat/conversations Persistent chat     │
│  POST /api/workspaces/{id}/draft/generate         SSE offer drafting  │
│  GET/PATCH/DELETE /api/workspaces/{id}/draft/:id  Draft CRUD + export │
│  GET  /api/portfolio                              Cross-workspace     │
│                                                    coverage/gaps table │
│  GET  /api/workspaces/{id}/elements               All elements        │
│  POST /api/workspaces/{id}/reset                  Wipe workspace      │
└───┬──────────────┬──────────────┬────────────────────────────────────┘
    │              │              │
┌───▼───┐      ┌───▼──────┐  ┌───▼──────────────────────────────────┐
│Neo4j  │      │ Qdrant   │  │  PostgreSQL                          │
│:7687  │      │ :6333    │  │  :5432                               │
│       │      │          │  │  workspaces, chat_conversations,     │
│ Per-  │      │ Per-     │  │  chat_messages, contract_drafts,     │
│ work- │      │ workspace│  │  plus synthetic_* tables (see        │
│ space │      │ ws_{id}  │  │  Synthetic Data Studio below)        │
│ nodes │      │          │  └──────────────────────────────────────┘
└───────┘      └──────────┘
```

### Workspace isolation

| Layer | Isolation mechanism |
|-------|-------------------|
| **PostgreSQL** | One row per workspace — metadata only |
| **Neo4j** | Composite unique constraint `(id, workspace_id) IS UNIQUE`; all queries filter by `workspace_id` |
| **Qdrant** | Separate collection per workspace: `ws_{workspace_id}` |
| **Pipeline** | Per-workspace coordinator and write lock — concurrent runs in the same workspace share one cross-doc extraction batch; different workspaces run fully in parallel. Pipeline state persists across workspace navigation (workspace-scoped Zustand store). |

### Pipeline — five steps (SSE streaming)

```
1  Parse          PDF/DOCX → text pages
                  ┌ Digital PDF  → PyMuPDF native text extraction
                  │               Tables: find_tables() row boundaries +
                  │               get_drawings() ruling lines → column reconstruction
                  ├ Scanned PDF  → PyMuPDF render at 150 DPI grayscale → Tesseract OCR
                  │               Tables: img2table (OpenCV pixel-edge border detection)
                  │               + TesseractOCR cell fill; multi-line cell merge heuristic
                  │               Per-page OCR progress streams live to the UI
                  └ DOCX         → python-docx body order traversal (paragraphs + tables)
                                  Tables: merged-cell dedup + column normalization
                  All tables appended as GFM markdown to page text for the LLM extractor
                  page_contents (page_num, native_text, ocr_text, tables) stored per page
                  Pages with >40% non-ASCII are dropped (garbled OCR filter)
                  SHA-256 dedup skips already-ingested files

2  Extract (LLM)  Section-aware chunking — section headers detected per page
                  Each chunk prefixed [Section | Page N] for structural context
                  GPT-4o function calling (temperature=0) → AtomicElement objects
                  (Requirement / Clause / Risk / Mitigation / LD)
                  IDs are doc-scoped: RFPA_REQ_001, CONT_CL_001

3  Build Graph    Coordinator pattern — concurrent pipeline runs share a single
                  combined cross-doc LLM call (6 s quiescence window)
                  Elements sorted by ID before relationship extraction (deterministic)
                  Relationship types: COVERS / PARTIALLY_COVERS /
                    INTRODUCES_RISK / MITIGATED_BY / LINKED_TO_LD / CONTRADICTS
                  Direction enforced post-LLM (auto-flip guard for all types)
                  Semantic relationships: clear-and-rewrite each run (no stale accumulation)

4  Index Vectors  BGE-M3 embeddings → workspace Qdrant collection
                  Payload: section, page_number — enables section-scoped search

5  Coverage       Graph traversal per Requirement → Covered / Partial / Not Covered
                  All cross-doc relationships already written in Step 3 — no re-extraction
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · TypeScript · Vite · React Router v7 · React Flow v12 · d3-force · dagre · Tailwind CSS v3 · Framer Motion · Zustand |
| API | FastAPI · uvicorn · SSE streaming |
| LLM extraction | GPT-4o (OpenAI function calling — structured output) |
| Graph store | Neo4j 5.x (Cypher MERGE, typed edges, composite workspace constraint) |
| Vector store | Qdrant (per-workspace collections) |
| Embeddings | BAAI/bge-m3 (sentence-transformers, 1024-dim) |
| Workspace metadata | PostgreSQL 16 (psycopg2) |
| OCR | Tesseract 5.x + pytesseract + PyMuPDF rendering at 150 DPI grayscale (scanned PDF fallback, per-page live progress) |
| Scanned table extraction | img2table + OpenCV (pixel-edge border detection → cell extraction from rendered page images) |

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

> Tesseract is only needed for scanned (image-based) PDFs. Digital PDFs and DOCX files work without it.

> `img2table` (for scanned PDF table extraction) is included in `backend/requirements.txt` — no separate install needed.

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
| `9000` | MinIO S3 API (Studio artifacts) |
| `9001` | MinIO web console |
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

Starts **Neo4j**, **Qdrant**, **PostgreSQL**, and **MinIO** (with a one-shot job that creates the `synthetic` bucket). Wait ~20 seconds, then verify:

```bash
docker compose ps   # all should show "healthy" or "running"
```

> **Neo4j browser** is at http://localhost:7474 (user: `neo4j`, password: `password`).
> **MinIO console** is at http://localhost:9001 (user: `minioadmin`, password: `minioadmin`).

### 5 — Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

> First run downloads the BGE-M3 model (~2 GB). This happens once and is cached by Hugging Face.

### 6 — Install frontend dependencies

```bash
cd frontend1 && npm install && cd ..
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
NEO4J_PASSWORD=password
NEO4J_DATABASE=neo4j

# ── Qdrant ──────────────────────────────────────────────────────────────────
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=graphrag_elements   # Base name — per-workspace: ws_{id}

# ── PostgreSQL (workspace metadata) ─────────────────────────────────────────
POSTGRES_URL=postgresql://graphrag:graphrag@localhost:5432/graphrag

# ── Embeddings ───────────────────────────────────────────────────────────────
EMBEDDING_MODEL=BAAI/bge-m3       # Change to all-MiniLM-L6-v2 for faster dev
EMBEDDING_DIMENSION=1024          # Must match the model's output dimension

# ── Quality ──────────────────────────────────────────────────────────────────
CONFIDENCE_THRESHOLD=0.5
MAX_TOKENS_EXTRACTION=4000
MAX_CHUNK_CHARS=3000
CHUNK_OVERLAP_CHARS=200

# ── Synthetic Data Studio ─────────────────────────────────────────────────────
SYNTHETIC_STORAGE_BACKEND=s3          # "s3" (MinIO) or "local" (filesystem)
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=synthetic
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
SYNTHETIC_QDRANT_COLLECTION=synthetic_elements
SYNTHETIC_MIN_THRESHOLD=5             # min examples per matrix cell
SYNTHETIC_DUP_EXACT=0.97             # cosine ≥ → exact duplicate
SYNTHETIC_DUP_NEAR=0.90             # cosine ≥ → near duplicate
SYNTHETIC_REALISM_FLOOR=0.6          # realism < → flagged for regeneration
SYNTHETIC_MAX_REGEN=2                # regeneration attempts per failed record
```

**Development shortcut — faster and cheaper:**

```env
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

---

## Project Structure

```
GraphRAG POC/
│
├── backend/
│   ├── api/
│   │   ├── main.py                 ← FastAPI app, CORS, router registration, Postgres init
│   │   ├── deps.py                 ← Per-workspace service factory + singleton cache
│   │   └── routes/
│   │       ├── workspaces.py       ← CRUD /api/workspaces (Postgres-backed)
│   │       ├── pipeline.py         ← POST pipeline/run — SSE streaming + coordinator pattern
│   │       ├── graph.py            ← GET graph/data, subgraph, cross-doc-relationships, stats
│   │       ├── traceability.py     ← GET traceability/coverage + chain/:id + contradictions
│   │       ├── chat.py             ← POST chat/ask (intent-aware Q&A) + persistent conversations CRUD
│   │       ├── contract_draft.py   ← SSE draft/generate, draft CRUD, section revise, export .md/.docx
│   │       ├── portfolio.py        ← GET /api/portfolio — cross-workspace coverage/gaps/contradictions
│   │       ├── status.py           ← GET/POST status, reset, elements
│   │       └── synthetic.py        ← /api/studio — projects, seeds, generate (SSE), sme, publish
│   │
│   ├── config/settings.py          ← All env vars as frozen dataclass
│   │
│   ├── db/postgres.py              ← Workspace/chat/contract_draft CRUD (psycopg2, sync, wrapped in to_thread)
│   │
│   ├── core/
│   │   ├── models.py               ← AtomicElement, Relationship, ParsedDocument, CoverageResult
│   │   ├── interfaces.py           ← IParser, IExtractor, IGraphStore, IVectorStore (ABCs)
│   │   └── exceptions.py
│   │
│   ├── parsers/
│   │   ├── pdf_parser.py           ← Digital: PyMuPDF native text + ruling-line table reconstruction
│   │   │                             Scanned: Tesseract OCR + img2table pixel-edge table extraction
│   │   └── docx_parser.py          ← Body-order traversal; paragraph + table extraction (python-docx)
│   │
│   ├── extractors/llm_extractor.py ← Section-aware chunking → GPT-4o function calling
│   │
│   ├── graph/
│   │   ├── neo4j_store.py          ← IGraphStore; composite (id, workspace_id) constraint
│   │   │                             get_cross_document_relationships() for sidebar
│   │   ├── builder.py              ← GraphBuilder: build, assess_coverage, traceability chain
│   │   │                             is_inter_document resolved via CONTAINS edge (robust)
│   │   └── visualizer.py           ← Legacy (unused in React UI)
│   │
│   ├── vector/
│   │   ├── embedder.py             ← BGEEmbedder singleton (lazy-loads BAAI/bge-m3)
│   │   └── qdrant_store.py         ← Per-workspace collection ws_{workspace_id}
│   │
│   ├── services/
│   │   ├── document_service.py     ← Parse + extract + cross-doc relationship extraction
│   │   ├── graph_service.py        ← Workspace-scoped facade over Neo4j + Qdrant
│   │   ├── qa_service.py           ← Intent detection → evidence → GPT-4o synthesis
│   │   └── contract_draft_service.py ← Grounding bundle (all requirements, tagged by status)
│   │                                  + GPT-4o draft generation + citation verification
│   │                                  against real text (never fabricated evidence)
│   │
│   └── synthetic/                  ← Synthetic Data Studio (four core services)
│       ├── taxonomy.py             ← ElementType×TaxonomyLabel matrix + business rules
│       ├── schemas.py              ← Pydantic models / JSON Schema (schema validity)
│       ├── models.py               ← SyntheticRecord / Relationship / Document + reports
│       ├── storage.py              ← Artifact store (MinIO/S3 default, local fallback)
│       ├── db.py                   ← Postgres persistence (synthetic_* tables)
│       ├── generation_service.py   ← Generation (records / relationships / docs; brief + mirror)
│       ├── validation_service.py   ← Schema · label · coverage-consistency validation
│       ├── quality_service.py      ← Duplicate · realism (LLM-judge) · diversity/balance
│       ├── sme_service.py          ← Stratified sampling + verdicts + feedback
│       └── dataset_service.py      ← Orchestration · versioning · lineage · promote · publish
│
├── frontend1/                       ← Active frontend (the legacy `frontend/` dir is unused)
│   └── src/
│       ├── main.tsx                ← BrowserRouter wrapper, exported queryClient
│       ├── App.tsx                 ← Route definitions (React Router v7)
│       ├── types/analysis.ts       ← Shared TypeScript interfaces (graph, chat, draft, portfolio…)
│       ├── index.css               ← Tailwind + dark/light theme CSS custom properties
│       ├── api/                    ← One fetch-wrapper module per resource (client.ts has the
│       │                             shared apiGet/apiPost/apiPatch/apiDelete/postSSE helpers)
│       ├── pages/
│       │   ├── LandingPage.tsx     ← / — feature highlights + entry points (Workspaces, Studio)
│       │   ├── WorkspacesPage.tsx  ← Analysis workspace grid, Cards/Table (portfolio) view toggle
│       │   ├── WorkspacePage.tsx   ← /workspace/:id/:tab — keep-alive tabs, URL routing
│       │   ├── ChatPage.tsx        ← /workspace/:id/chat — persistent multi-conversation chat
│       │   ├── StudioProjectsPage.tsx ← /studio — Studio project grid
│       │   └── StudioProjectPage.tsx  ← /studio/project/:id — 5 keep-alive tabs
│       └── components/
│           ├── studio/             ← GenerateTab · ValidateTab · QualityTab · SMEReviewTab · DatasetsTab
│           └── workspace/
│               ├── WorkflowPanel.tsx   ← Upload zone + SSE pipeline trigger + run history
│               ├── KnowledgeGraph.tsx  ← React Flow + d3-force/dagre + cross-doc sidebar
│               ├── ElementsTable.tsx / ElementsView.tsx ← "Explorer" tab: split-panel document viewer
│               ├── TraceabilityView.tsx← Coverage lineage, INTER/INTRA badges, contradictions card
│               ├── DraftTab.tsx        ← "Draft" tab: offer/proposal generation, contentEditable
│               │                         review surface with inline AI-assisted rewriting, export
│               ├── ChatWindow.tsx      ← Floating single-question chat + evidence source cards
│               ├── SyntheticLibraryModal.tsx ← Import documents from the Synthetic Studio library
│               └── PipelineProgress.tsx← Step stepper UI
│
├── Data_Samples/                   ← Sample procurement documents for testing
├── docker-compose.yml              ← Neo4j 5.x + Qdrant + PostgreSQL 16 + MinIO
├── start_api.sh
└── start_frontend.sh
```

---

## UI Walkthrough

### Workspace grid (`/workspaces`)

Two views, toggled with a button in the header:

- **Cards** (default) — one card per workspace: name/description, created/updated dates, rename and delete actions in an overflow menu
- **Table** — a sortable **portfolio comparison** across every workspace with data: coverage %, requirements needing attention, gaps, and contradiction count, backed by `GET /api/portfolio`. Built for a bid/proposal manager juggling several deals at once — click any row to open that workspace.

Create workspace (name + optional description → isolated Neo4j/Qdrant scope) and delete workspace (removes all Neo4j nodes, Qdrant collection, and Postgres row) are available from either view.

### Workspace app (`/workspace/:id/:tab`)

Five tabs — **Ingest · Explorer · Graph · Traceability · Draft**. Tabs use CSS keep-alive (absolute positioning, `display: none` when inactive) so switching tabs does not remount components or lose state. URL updates to `/workspace/:id/:tab` — deep links and browser back/forward work correctly.

#### Ingest tab

Drop PDF or DOCX files. Filename keywords control document-type detection:

| Filename keyword | Detected as |
|-----------------|-------------|
| `rfp`, `rfx`, `tender` | RFP → extracts `Requirement` nodes |
| `risk`, `rmc`, `register` | Risk Sheet → extracts `Risk` + `Mitigation` |
| `contract`, `offer`, `agreement` | Contract → extracts `Clause` + `LD` |

Click **Run Pipeline**. Five steps stream live via SSE with verbose per-chunk and per-page OCR logs. Re-uploading the same file is safe — SHA-256 dedup skips it.

The right column shows a **step stepper**, live activity log, and **Run History** (all past pipeline runs per workspace). Pipeline state is workspace-scoped — navigating away and back preserves the run history and status. If a pipeline completes while you are in a different workspace, a **global toast notification** appears with a link to navigate back.

#### Explorer tab

Split-panel document viewer. The **left rail** (~208 px) shows a document selector — filename, type, and page count. The **right area** has a mode bar at the top with **[Text] [OCR] [Tables]** content buttons and an **[Elements · N]** button, plus scrollable page chips (amber dot on chips that have tables or OCR content). The content area is full-width: text and OCR are shown as readable prose; tables are rendered with proper column widths and cell padding. The **Elements** mode shows a filterable, sortable table of all extracted elements with type pills, search by text/ID/source, and row expansion for full metadata.

#### Graph tab

Interactive knowledge graph powered by **React Flow + d3-force/dagre**:

| Node colour | Element type |
|------------|-------------|
| Indigo | Requirement |
| Emerald | Clause |
| Red | Risk |
| Amber | Mitigation |
| Purple | LD (Liquidated Damages) |
| Slate | Document |

Controls:
- **Click** a node → highlight connected edges + node detail panel
- **Double-click** a node → expand its 1-hop neighbourhood inline
- **Force / Hierarchy** → toggle between d3-force and dagre LR layout
- **CONTAINS** → show/hide Document→Element containment edges
- **Cross-Doc** → open the cross-document relationships sidebar

**Cross-Doc sidebar** shows every edge that crosses document boundaries, fetched from a dedicated backend endpoint. Includes relationship type filter pills, search, evidence text on expand, and click-to-highlight the edge in the graph.

#### Traceability tab

Left panel lists every Requirement with its coverage badge (Covered / Partial / Gap) and a coverage score progress bar. Click a requirement to see its lineage across four columns — **Clauses · Risks · Mitigations · LDs** — with **↔ INTER** (cross-document) and **↕ INTRA** (same-document) badges per element, and a gaps alert if risks lack mitigations or LDs.

A separate **Contradictions** card surfaces every `CONTRADICTS` edge in the workspace (same-document or cross-document), showing both clause texts side by side with the evidence line — previously this relationship type was only visible as a colored edge buried in the Graph tab.

#### Draft tab

Generates a complete, evidence-backed **offer/proposal** in response to an ingested RFP — grounded in the workspace's real coverage/traceability data, not fabricated content. An RFP, an offer/proposal, and a signed contract are different deal stages; this feature drafts the middle one (the vendor's negotiable response), not the final agreement.

- **Templates** — "Offer / Proposal" (default; point-by-point response, with a "Response to Requirements" section organized around the RFP's own requirement categories, filtered to exclude administrative sections like Evaluation Criteria or Submission Instructions) or "Services Agreement" (a fixed clause-oriented structure).
- **Generation** — streamed via SSE (grounding → drafting → citing → persisting), addresses **every** requirement — restating already-covered ones and proposing new language for genuine gaps — so the result is a comprehensive response, not just a gap patch.
- **Anti-hallucination citations** — every cited evidence quote is verified as an actual verbatim substring of the real requirement/clause text; a citation that fails verification (including after an edit invalidates it) is downgraded rather than trusted.
- **Review surface** — the whole draft is one continuous, editable document (not per-section edit toggles): edit text directly, or select any span to get an inline "Ask AI" popup that rewrites just that selection.
- **Export** — Markdown or .docx, per draft. Past drafts are listed and can be deleted.

#### Chat

Two entry points:
- **Floating chat** — a bottom-right button available from any workspace tab, for one-off intent-aware Q&A using Cypher graph traversal + BGE-M3 semantic search, with collapsible source evidence cards.
- **Chat page** (`/workspace/:id/chat`) — persistent, multi-conversation chat history per workspace, for longer research sessions you want to come back to.

---

## Extending the System

### Adding a new parser (e.g. Excel)

1. Create `backend/parsers/excel_parser.py` implementing `IParser` from `core/interfaces.py`
2. Register it in `backend/parsers/__init__.py` inside `ParserFactory._parsers`

### Adding a new element type

1. Add the value to `ElementType` in `backend/core/models.py`
2. Update the extraction prompt in `backend/extractors/llm_extractor.py`
3. Add the ID prefix to `prefix_map` in the same file
4. Add the node colour to `TYPE_CONFIG` in `frontend1/src/components/workspace/KnowledgeGraph.tsx`
5. Add the colour to `TYPE_ACCENT` in `frontend1/src/components/workspace/TraceabilityView.tsx`

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

**Useful Cypher (replace `<wid>` with workspace ID from Postgres):**

```cypher
// All elements in a workspace
MATCH (e:Element {workspace_id: '<wid>'})
RETURN e.id, e.type, e.section ORDER BY e.type

// All cross-document relationships
MATCH (a:Element {workspace_id: '<wid>'})-[r]->(b:Element {workspace_id: '<wid>'})
WHERE type(r) <> 'CONTAINS' AND a.document_id <> b.document_id
RETURN a.id, type(r), b.id, r.confidence ORDER BY type(r)

// Uncovered requirements
MATCH (req:Element {type: 'Requirement', workspace_id: '<wid>'})
WHERE NOT (req)<-[:COVERS]-() AND NOT (req)<-[:PARTIALLY_COVERS]-()
RETURN req.id, req.text, req.section
```

---

## Troubleshooting

### Coverage shows "Not Covered" for everything

1. Check backend logs — look for `Auto-flipped` messages indicating direction was corrected.
2. Wipe the workspace (Wipe button), then re-upload all documents in one pipeline run.
3. Verify document filenames contain the right keywords (`rfp`, `contract`, `risk`) so type detection works correctly.
4. Lower `CONFIDENCE_THRESHOLD=0.4` in `.env` and restart the API if relationships exist but scores are low.

### "Could not initialize PostgreSQL" on startup

Docker Compose wasn't started first, or Postgres isn't healthy yet:
```bash
docker compose up -d
docker compose ps   # confirm postgres shows "healthy"
```

### Scanned PDF extracts nothing

Check Tesseract: `tesseract --version`. Install with `brew install tesseract` (macOS) or `sudo apt-get install tesseract-ocr`.

For **table extraction** from scanned pages, `img2table` is used automatically when available (it is listed in `backend/requirements.txt`). If tables are still not appearing, confirm the package installed correctly: `pip show img2table`. If `img2table` is unavailable the pipeline falls back gracefully — text OCR will still work, but table structure will not be recovered from scanned pages.

### "Neo4j: Connection refused"

```bash
docker compose up -d
docker compose logs neo4j   # wait ~20 seconds after starting
```

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

### "No Requirements found" in Traceability

Document type is inferred from the filename. Rename the RFP to include `rfp` (e.g. `rfp_project.pdf`), wipe the workspace, then re-upload.

### Cross-doc sidebar shows 0 relationships

Wipe the workspace and re-ingest all documents together in one run. Relationships are extracted once in Step 3 by the coordinator — uploading all files together ensures the LLM sees the full combined element set when inferring cross-document links.

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

# Full reset — removes containers AND volumes (all workspaces deleted)
docker compose down -v
```
