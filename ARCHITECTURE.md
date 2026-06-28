# Architecture

This document describes the current system architecture: a multi-workspace procurement intelligence platform with a React frontend, FastAPI backend, Neo4j graph store, Qdrant vector index, and PostgreSQL workspace registry.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Multi-Workspace Model](#2-multi-workspace-model)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Data Model](#5-data-model)
6. [Pipeline Architecture](#6-pipeline-architecture)
7. [Graph Layer](#7-graph-layer)
8. [Vector Layer](#8-vector-layer)
9. [Q&A Service](#9-qa-service)
10. [API Surface](#10-api-surface)
11. [Key Design Decisions](#11-key-design-decisions)

---

## 1. System Overview

```
                        Browser (React + Vite)
                         localhost:5173
                               │
                       HTTP  / SSE streaming
                               │
                     ┌─────────▼─────────┐
                     │   FastAPI / uvicorn │
                     │   localhost:8000    │
                     └───┬─────┬──────┬───┘
                         │     │      │
              ┌──────────▼──┐  │  ┌───▼────────────┐
              │   Neo4j     │  │  │  Qdrant         │
              │  :7687      │  │  │  :6333          │
              │  knowledge  │  │  │  per-workspace  │
              │  graph      │  │  │  vector index   │
              └─────────────┘  │  └────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │    PostgreSQL        │
                    │    :5432            │
                    │  workspace registry │
                    └─────────────────────┘
```

All three data stores are multiplexed across workspaces:
- **Neo4j**: all nodes carry `workspace_id` — queries always include `{workspace_id: $wid}`
- **Qdrant**: one collection per workspace, named `ws_{workspace_id}`
- **PostgreSQL**: one row per workspace — stores id, name, description, timestamps only

---

## 2. Multi-Workspace Model

### Workspace lifecycle

```
POST /api/workspaces          → creates Postgres row
  ↓
User uploads documents and runs pipeline
  → Neo4j nodes written with workspace_id
  → Qdrant collection ws_{id} created/populated
  ↓
DELETE /api/workspaces/{id}   → deletes Postgres row
                              → MATCH (e {workspace_id:id}) DETACH DELETE
                              → Qdrant collection ws_{id} deleted
```

### Isolation guarantees

| Store | Isolation mechanism | What happens if violated |
|-------|-------------------|-------------------------|
| Neo4j | `workspace_id` property on every node + all queries filter by it | Cross-contamination of graph data |
| Qdrant | Separate named collection per workspace | Vector search returns other workspace's results |
| PostgreSQL | Row-level ownership | None — metadata only |
| Pipeline | `per_workspace_coordinator` dict + write lock | Concurrent runs in same workspace would double-write cross-doc edges |

### Neo4j constraint

```cypher
CREATE CONSTRAINT element_workspace_unique
IF NOT EXISTS
FOR (e:Element) REQUIRE (e.id, e.workspace_id) IS UNIQUE
```

This prevents duplicate nodes across workspaces (same extracted ID, different workspace).

### Service factory

`backend/api/deps.py` maintains a per-workspace singleton cache:

```python
_service_cache: dict[str, GraphService] = {}

def get_graph_service(workspace_id: str) -> GraphService:
    if workspace_id not in _service_cache:
        _service_cache[workspace_id] = GraphService(workspace_id)
    return _service_cache[workspace_id]
```

Each `GraphService` instance holds a Neo4j session factory and a Qdrant client — both scoped to the workspace.

---

## 3. Frontend Architecture

### Technology stack

| Library | Version | Role |
|---------|---------|------|
| React | 18 | Component model |
| TypeScript | 5 | Type safety |
| Vite | 5 | Dev server + bundler |
| React Router | v7 | URL-driven navigation |
| React Flow | 12 | Interactive graph canvas |
| d3-force | 3 | Physics simulation layout |
| dagre | 0.8 | Hierarchical LR layout |
| Tailwind CSS | v3 | Utility-first styling |
| Framer Motion | 11 | Animations |
| Zustand | 4 | Global pipeline state |
| Lucide React | — | Icons |

### Page routing

```
/                    → redirect → /workspaces
/workspaces          → WorkspacesPage (workspace grid)
/workspace/:id       → redirect → /workspace/:id/ingest
/workspace/:id/:tab  → WorkspacePage (keep-alive tab shell)
```

React Router v7 handles all navigation. Deep links work — bookmarking `/workspace/abc/traceability` opens that exact tab.

### Component hierarchy

```
App.tsx (BrowserRouter)
├── WorkspacesPage          /workspaces
│   └── workspace cards (create, open, delete)
│
└── WorkspacePage           /workspace/:id/:tab
    ├── Header (logo, nav, stats, theme toggle, wipe button)
    ├── TabBar (Ingest | Elements | Graph | Traceability)
    ├── [keep-alive tab container]
    │   ├── WorkflowPanel        (Ingest tab)
    │   │   ├── UploadZone
    │   │   ├── PipelineProgress
    │   │   └── Run History
    │   ├── ElementsTable        (Elements tab)
    │   ├── KnowledgeGraph       (Graph tab)
    │   │   └── CrossDocSidebar  (slide-in panel)
    │   └── TraceabilityView     (Traceability tab)
    └── ChatWindow               (floating, always mounted)
```

### Keep-alive tabs

Tabs that have been visited stay mounted — only their CSS `display` property toggles. This preserves:
- React Flow's zoom/pan state between graph interactions
- ElementsTable filter/sort state
- Chat history (ChatWindow is always mounted)

```tsx
// WorkspacePage.tsx
const tabStyle = (t: Tab): React.CSSProperties => ({
  position: 'absolute', inset: 0,
  display: tab === t ? 'block' : 'none',
  overflow: 'hidden',
})
```

The `visitedTabs` set gates rendering — a tab's component doesn't mount until first visit, avoiding unnecessary API calls.

### Zustand pipeline store

`pipelineStore` tracks all pipeline jobs for the current session:

```ts
interface PipelineState {
  jobs: PipelineJob[]
  addJob(files: string[]): string        // returns job ID
  updateJob(id: string, patch: Partial<PipelineJob>): void
  addLog(id: string, line: LogLine): void
  clearJobs(): void
}
```

The store is global (not per-workspace). When navigating to a new workspace, `WorkspacePage` calls `usePipelineStore.getState().clearJobs()` in a `useEffect` on the `workspaceId` dependency — this ensures the Run History tab shows only the current workspace's jobs.

### Theme system

Dark/light mode is driven by CSS custom properties on `:root` / `.dark`. `ThemeContext` holds the current mode and provides a toggle. `ThemeToggle` renders the button.

```css
/* index.css */
:root {
  --bg: #ffffff;
  --surface: #f9fafb;
  --primary: #6366f1;
  ...
}
.dark {
  --bg: #0f1117;
  --surface: #161b22;
  ...
}
```

Tailwind uses `bg-bg`, `text-foreground`, etc. as `var(--bg)` references. A known Tailwind v3 issue wraps CSS var hex values in `rgb()` for `border-color`, causing them to render as `currentColor`. This is fixed with plain CSS overrides in `index.css`:

```css
.border-border { border-color: var(--border) !important; }
```

### API client

All fetch wrappers live in `frontend/src/api/client.ts`. Every function takes `workspaceId` as its first argument and uses the path helper `ws(workspaceId) = /api/workspaces/${workspaceId}`. Vite's dev proxy forwards `/api` → `localhost:8000`.

SSE streaming is handled by `streamPipeline()` — reads chunks from `response.body`, splits on `\n`, and parses `data: ` prefix lines.

---

## 4. Backend Architecture

### Request path

```
Browser → Vite proxy → FastAPI → route handler
                                    │
                             ┌──────┴──────────────┐
                             │                     │
                         get_graph_service()    Postgres helpers
                             │
                    GraphService(workspace_id)
                    ├── Neo4jStore (graph queries)
                    ├── QdrantStore (vector search)
                    └── (optionally) QAService
```

### Module breakdown

| Module | Responsibility |
|--------|---------------|
| `api/main.py` | FastAPI app creation, CORS, router registration, Postgres schema init on startup |
| `api/deps.py` | `get_graph_service()` singleton factory; Postgres connection helper |
| `api/routes/workspaces.py` | Workspace CRUD (Postgres-backed) — create, list, get, update, delete |
| `api/routes/pipeline.py` | `POST /pipeline/run` — multipart upload → SSE streaming pipeline |
| `api/routes/graph.py` | Graph data, subgraph expansion, cross-doc relationships, graph stats |
| `api/routes/traceability.py` | Coverage assessment list + full traceability chain for one requirement |
| `api/routes/chat.py` | Intent-aware Q&A — delegates to QAService |
| `api/routes/status.py` | Workspace status, elements list, reset |
| `config/settings.py` | Frozen dataclass; reads all env vars once at import time |
| `db/postgres.py` | Workspace CRUD with psycopg2 — all blocking calls wrapped in `asyncio.to_thread` |
| `core/models.py` | `AtomicElement`, `Relationship`, `ParsedDocument`, `CoverageResult`, `ElementType` |
| `core/interfaces.py` | `IParser`, `IExtractor`, `IGraphStore`, `IVectorStore` ABCs |
| `parsers/` | `PDFParser` (PyMuPDF + Tesseract fallback), `DocxParser` |
| `extractors/` | `LLMExtractor` — GPT-4o function calling, section-aware chunking |
| `graph/neo4j_store.py` | `IGraphStore` implementation; all Cypher queries; workspace-scoped |
| `graph/builder.py` | `GraphBuilder` — cross-doc relationship extraction, coverage assessment, traceability chain |
| `vector/embedder.py` | `BGEEmbedder` singleton — lazy-loads BAAI/bge-m3 |
| `vector/qdrant_store.py` | Per-workspace Qdrant collection creation, upsert, search |
| `services/document_service.py` | Orchestrates parse → extract → write Neo4j → write Qdrant |
| `services/graph_service.py` | Workspace-scoped facade — used by all API route handlers |
| `services/qa_service.py` | Intent classification → evidence gathering → GPT-4o synthesis |

---

## 5. Data Model

### Neo4j node

All nodes use the label `Element`:

```
(:Element {
  id:           string   // e.g. "RFP1_REQ_001", "CONT_CL_003"
  workspace_id: string   // UUID — all queries scope by this
  type:         string   // "Requirement" | "Clause" | "Risk" | "Mitigation" | "LD" | "Document"
  text:         string   // full extracted text
  source:       string   // section label + page number hint
  document_id:  string   // ID of the Document node that owns this element (may be null pre-fix)
  confidence:   float    // extraction confidence (0.0–1.0)
})
```

### Document ownership via CONTAINS

The authoritative document-to-element mapping is the `CONTAINS` edge, written during the Build Graph step:

```cypher
MATCH (doc:Element {type:'Document', workspace_id:$wid, id:$doc_id})
MATCH (elem:Element {id:$elem_id, workspace_id:$wid})
MERGE (doc)-[:CONTAINS]->(elem)
```

`builder.py::get_element_doc_id()` resolves document ownership by traversing this edge first, then falls back to the stored `document_id` property. This is the correct approach because `document_id` can be `None` in Neo4j even when the Python code set `""` (null vs missing key behaviour in the Bolt driver).

### Relationship types

| Relationship | Semantics |
|-------------|----------|
| `CONTAINS` | Document → Element (ownership, written at build time) |
| `COVERS` | Clause fully satisfies a Requirement |
| `PARTIALLY_COVERS` | Clause partially satisfies a Requirement |
| `INTRODUCES_RISK` | Requirement or Clause introduces a Risk |
| `MITIGATED_BY` | Risk is addressed by a Mitigation |
| `LINKED_TO_LD` | Clause or Requirement linked to a Liquidated Damages term |
| `CONTRADICTS` | Element contradicts another |

All semantic relationships carry:
```
[r {
  confidence: float   // 0.0–1.0 (from LLM extraction)
  evidence:   string  // quoted text supporting the relationship
}]
```

### Coverage result

The coverage assessment walks this graph:

```
Requirement ←─COVERS─┤
                      Clause
Requirement ←─PARTIALLY_COVERS─┤

Clause / Requirement ─INTRODUCES_RISK→ Risk ─MITIGATED_BY→ Mitigation
                                             ─LINKED_TO_LD→ LD
```

Coverage status:
- **Covered** — at least one `COVERS` relationship
- **Partially Covered** — at least one `PARTIALLY_COVERS`, no full `COVERS`
- **Not Covered** — no covering clause at all

### INTER vs INTRA document classification

Used in the Traceability tab to badge each element:

```python
# builder.py
elem_doc_id = self.store.get_element_doc_id(element_id, workspace_id) or elem.document_id
is_inter = bool(elem_doc_id) and bool(req_doc_id) and elem_doc_id != req_doc_id
```

`get_element_doc_id` uses `CONTAINS` edge traversal — not the stored `document_id` property — because Neo4j returns `None` (not `""`) for null property values, making string equality unreliable.

---

## 6. Pipeline Architecture

### Steps

```
┌─────────┬──────────────┬───────────────────────────────────────────────────────┐
│  Step   │  Name        │  What happens                                         │
├─────────┼──────────────┼───────────────────────────────────────────────────────┤
│  1      │  Parse       │  PDF/DOCX → pages with text + section metadata        │
│         │              │  Digital PDF: PyMuPDF native text extraction           │
│         │              │  Scanned PDF: PyMuPDF → 200dpi PNG → Tesseract OCR    │
│         │              │  SHA-256 dedup skips already-ingested files            │
├─────────┼──────────────┼───────────────────────────────────────────────────────┤
│  2      │  Extract     │  Section-aware chunking → GPT-4o function calling     │
│         │              │  → AtomicElement objects (Req/Clause/Risk/Mitg/LD)    │
├─────────┼──────────────┼───────────────────────────────────────────────────────┤
│  3      │  Build Graph │  Coordinator: gather all elements from concurrent     │
│         │              │  runs (6s quiescence), then one LLM call for cross-   │
│         │              │  doc relationships; MERGE into Neo4j idempotently     │
├─────────┼──────────────┼───────────────────────────────────────────────────────┤
│  4      │  Index       │  BGE-M3 embeddings → Qdrant collection ws_{id}        │
├─────────┼──────────────┼───────────────────────────────────────────────────────┤
│  5      │  Coverage    │  Re-sync: re-runs cross-doc relationship extraction    │
│         │              │  across ALL workspace elements (ensures consistency   │
│         │              │  regardless of ingestion order), then assesses        │
└─────────┴──────────────┴───────────────────────────────────────────────────────┘
```

### SSE streaming

```python
# pipeline.py route
async def run_pipeline(workspace_id, files, request):
    async def generate():
        async for event in pipeline.run(workspace_id, files):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")
```

Events emitted:
```json
{ "type": "step_start",    "step": "extract", "label": "Extract", "total": 3 }
{ "type": "step_progress", "step": "extract", "message": "...", "current": 1, "total": 3 }
{ "type": "step_complete", "step": "extract", "count": 42, "elapsed": 8.3 }
{ "type": "pipeline_complete", "summary": { "documents": 3, "elements": 87, ... } }
{ "type": "error",         "step": "build",   "message": "..." }
```

### Coordinator pattern

Cross-document relationship extraction requires all elements from all documents to be available in one LLM call. This is handled by a per-workspace coordinator:

```python
class PipelineCoordinator:
    # Collects elements from concurrent runs (multiple files uploaded together)
    # Waits 6 seconds after last addition (quiescence window)
    # Then fires one combined LLM cross-doc extraction call
    # Prevents duplicate or partial cross-doc edges when files are ingested together
```

### Coverage re-sync (Step 5)

Before computing coverage, the pipeline re-runs cross-doc extraction across ALL elements in the workspace:

```python
# Step 5 start
all_elements = store.get_all_elements(workspace_id)
await extract_cross_document_relationships(all_elements, workspace_id)
# Then assess coverage
```

This ensures that uploading documents in separate batches (day 1: RFP, day 2: Contract) still produces correct cross-document edges. Without this, relationships would only exist between documents uploaded in the same run.

### Document type detection

Document type is inferred from the filename (case-insensitive keyword matching):

| Keywords | Document type | Extracts |
|----------|-------------|---------|
| `rfp`, `rfx`, `tender`, `requirement` | RFP | Requirement nodes |
| `risk`, `rmc`, `register`, `compliance` | Risk Sheet | Risk + Mitigation nodes |
| `contract`, `offer`, `agreement`, `ld` | Contract | Clause + LD nodes |

---

## 7. Graph Layer

### Neo4j store (`graph/neo4j_store.py`)

The store holds a singleton `Driver` instance. All public methods take `workspace_id` and filter every query by it.

Key methods:

| Method | Cypher pattern |
|--------|---------------|
| `save_elements(elements, wid)` | `MERGE (e:Element {id:$id, workspace_id:$wid}) SET e += $props` |
| `save_relationships(rels, wid)` | `MATCH (a {id:$src_id, workspace_id:$wid}) MATCH (b {id:$tgt_id, workspace_id:$wid}) MERGE (a)-[r:TYPE]->(b)` |
| `get_element(id, wid)` | `MATCH (e:Element {id:$id, workspace_id:$wid}) RETURN e` |
| `get_all_elements(wid)` | `MATCH (e:Element {workspace_id:$wid}) RETURN e` |
| `get_element_doc_id(id, wid)` | CONTAINS traversal (see §5 above) |
| `get_graph_for_visualization(wid)` | Returns all nodes + edges for React Flow rendering |
| `get_subgraph(node_id, wid)` | 1-hop neighbourhood — returns the clicked node + all direct neighbours |
| `get_cross_document_relationships(wid)` | Edges where `a.document_id <> b.document_id` (excludes CONTAINS) |
| `delete_workspace_data(wid)` | `MATCH (e:Element {workspace_id:$wid}) DETACH DELETE e` |

### Graph builder (`graph/builder.py`)

`GraphBuilder` runs on top of the store and implements higher-level operations:

- `build(documents, workspace_id)` — parse → extract → save elements → coordinator → cross-doc relationships → CONTAINS edges
- `assess_coverage(workspace_id)` → list of `CoverageResult`
- `get_traceability_chain(req_id, workspace_id)` → `TraceabilityChain` with INTER/INTRA classification per element

### React Flow graph data format

```python
# GET /graph/data response
{
  "nodes": [
    { "id": "RFP1_REQ_001", "type": "Requirement",
      "text": "...", "source": "§3.1 | page 4",
      "document_id": "DOC_RFP1", "confidence": 0.95 }
  ],
  "edges": [
    { "src": "CONT_CL_003", "tgt": "RFP1_REQ_001",
      "rtype": "COVERS", "conf": 0.87, "ev": "clause 4.2 explicitly states..." }
  ]
}
```

The frontend maps this to React Flow nodes and edges. Node colour is determined by `TYPE_CONFIG[type].color`. Edge style (dashed vs solid) represents relationship type.

---

## 8. Vector Layer

### BGE-M3 embedder (`vector/embedder.py`)

```python
class BGEEmbedder:
    _instance: Optional['BGEEmbedder'] = None

    @classmethod
    def get(cls) -> 'BGEEmbedder':
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        # Lazy-loads BAAI/bge-m3 from HuggingFace on first use (~2 GB)
        self.model = SentenceTransformer(settings.embedding_model)
```

BGE-M3 produces 1024-dimensional dense vectors. It supports English, Chinese, and multilingual procurement content.

### Qdrant store (`vector/qdrant_store.py`)

```python
collection_name = f"ws_{workspace_id}"

# Upsert: element text → embedding → PointStruct
# Payload fields: id, type, source, section, page_number, document_id

# Search: query text → embedding → nearest neighbours
# Returns: top-k elements with score and payload
```

Used by `QAService` for semantic similarity search — retrieves elements relevant to the user's question regardless of exact keyword match.

---

## 9. Q&A Service

`services/qa_service.py` implements intent-aware Q&A:

```
1. Classify intent from question text (keyword + pattern matching)
   "coverage", "risk", "ld", "contract", "compare" → COVERAGE | RISK | LD | CLAUSE | GENERAL

2. Gather evidence (varies by intent)
   COVERAGE → graph traversal: requirements + covering clauses
   RISK     → MATCH (:Risk)-[:MITIGATED_BY]->(:Mitigation)
   LD       → MATCH (:LD)
   CLAUSE   → semantic search in Qdrant
   GENERAL  → hybrid: Cypher traversal + vector search

3. Synthesize with GPT-4o
   System prompt includes structured evidence + intent hint
   → Answer with evidence citations

4. Return { answer, evidence: [...], query_type }
```

Evidence is returned to the frontend as structured `EvidenceItem` objects, rendered as collapsible source cards in `ChatWindow`.

---

## 10. API Surface

All routes are prefixed `/api/workspaces/{workspace_id}` except the workspace CRUD endpoints.

### Workspace CRUD

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/api/workspaces` | List all workspaces |
| `POST` | `/api/workspaces` | Create workspace |
| `GET` | `/api/workspaces/{id}` | Get one workspace |
| `PATCH` | `/api/workspaces/{id}` | Update name/description |
| `DELETE` | `/api/workspaces/{id}` | Delete workspace + wipe all data |

### Per-workspace endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `…/pipeline/run` | Upload files + stream pipeline as SSE |
| `GET` | `…/status` | Node/edge counts, `has_data` flag |
| `GET` | `…/elements` | All extracted elements |
| `POST` | `…/reset` | Wipe all graph + vector data for workspace |
| `GET` | `…/graph/data` | Full graph for React Flow (nodes + edges) |
| `GET` | `…/graph/subgraph/{id}` | 1-hop neighbourhood for a node |
| `GET` | `…/graph/cross-doc-relationships` | All edges crossing document boundaries |
| `GET` | `…/graph/stats` | Type-bucketed node/edge counts |
| `GET` | `…/traceability/coverage` | Coverage results for all requirements |
| `GET` | `…/traceability/chain/{req_id}` | Full traceability chain for one requirement |
| `POST` | `…/chat/ask` | Intent-aware Q&A |

---

## 11. Key Design Decisions

### CONTAINS edge as authoritative document ownership

**Problem:** Neo4j stores `document_id` as a string property on Element nodes. The Python code sets it to `""` for missing values, but the Bolt driver returns `None` (not `""`) when the key exists with a null value. This made the string equality check `elem_doc_id != req_doc_id` resolve to `True` for all elements — everything showed as INTER-document.

**Decision:** Resolve document ownership by traversing the `CONTAINS` relationship (written explicitly at build time) rather than reading the stored property. Falls back to the stored property only if no CONTAINS edge exists.

**Why:** CONTAINS edges are written as Cypher `MERGE` statements at build time — they are reliable regardless of null/None handling. The stored property is a denormalized cache that can go stale.

### Zustand store cleared on workspace navigation

**Problem:** `pipelineStore` is a global singleton. Opening workspace B after workspace A shows workspace A's run history.

**Decision:** Call `clearJobs()` in `WorkspacePage`'s `useEffect` on `workspaceId` change. This is the simplest correct fix — the store is session-local (not persisted), so clearing it on workspace navigation loses nothing important.

**Alternative considered:** Per-workspace store slices. Rejected — adds complexity for no benefit given the session-local nature of run history.

### CSS keep-alive for tabs

**Problem:** Unmounting React Flow on tab switch loses zoom/pan state. Remounting ElementsTable loses filter state.

**Decision:** All tabs use `display: none` (absolute positioned divs) rather than conditional rendering. A `visitedTabs` set prevents unmounted-tab API calls.

**Trade-off:** Higher initial memory usage since multiple React trees stay alive simultaneously. Acceptable given the bounded number of tabs (4).

### Dedicated cross-doc-relationships endpoint

**Problem:** The frontend originally tried to derive cross-document relationships from the React Flow graph data by comparing `node.data.document_id` values. This failed because the GET `/graph/data` response names the column `doc_id` in the Cypher query but the TypeScript `GraphNode` interface expects `document_id` — so all values were undefined.

**Decision:** Dedicated endpoint `GET /graph/cross-doc-relationships` that runs a single targeted Cypher query returning correctly named fields. Returns the full node info needed for the sidebar without any client-side derivation.

### Coverage re-sync at Step 5

**Problem:** Users may upload documents in multiple batches (RFP today, Contract tomorrow). Cross-doc relationship extraction in Step 3 only sees the documents from the current pipeline run — it cannot form relationships to documents from previous runs.

**Decision:** Step 5 re-runs cross-doc extraction across ALL elements in the workspace (not just newly uploaded ones). This is idempotent (MERGE) and ensures coverage is always accurate regardless of ingestion order.

**Cost:** One additional LLM call per pipeline run proportional to total workspace element count (not just new elements). Acceptable because coverage accuracy is a core product guarantee.
