# GraphRAG POC — Complete Technical Guide

> Everything that happens behind the scenes, explained from first principles.  
> Covers every file, every tab, every data transformation, every API call.

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [Tech Stack — What Each Tool Does and Why](#2-tech-stack)
3. [Project Structure — Every File Explained](#3-project-structure)
4. [End-to-End Data Flow](#4-end-to-end-data-flow)
5. [Layer 1 — Document Parsing](#5-layer-1--document-parsing)
6. [Layer 2 — LLM Extraction (GPT-4o)](#6-layer-2--llm-extraction-gpt-4o)
7. [Layer 3 — Knowledge Graph (Neo4j)](#7-layer-3--knowledge-graph-neo4j)
8. [Layer 4 — Vector Store (Qdrant + BGE-M3)](#8-layer-4--vector-store-qdrant--bge-m3)
9. [Layer 5 — Episodic Memory (Graphiti)](#9-layer-5--episodic-memory-graphiti)
10. [Tab 1 — Upload Documents](#10-tab-1--upload-documents)
11. [Tab 2 — Extract Elements](#11-tab-2--extract-elements)
12. [Tab 3 — Knowledge Graph](#12-tab-3--knowledge-graph)
13. [Tab 4 — Inter-Document Traceability](#13-tab-4--inter-document-traceability)
14. [Tab 5 — Ask Questions (Q&A)](#14-tab-5--ask-questions-qa)
15. [Sidebar — Infrastructure and Session Controls](#15-sidebar)
16. [Persistence, Session State and Reset Behaviour](#16-persistence-session-state-and-reset)
17. [Duplicate Detection and Idempotent Ingestion](#17-duplicate-detection)
18. [Configuration Reference](#18-configuration-reference)
19. [Error Reference](#19-error-reference)

---

## 1. What This System Does

This is a **GraphRAG** (Graph-augmented Retrieval Augmented Generation) proof-of-concept for **procurement document knowledge mapping**.

**The problem it solves:**  
In a procurement process you have three distinct documents:
- An **RFP** (Request for Proposal) listing what the buyer *requires*.
- A **Risk Sheet** listing what can go *wrong* and how those risks are mitigated or penalised.
- A **Contract / MSA** listing what the supplier has *agreed to deliver*.

Manually cross-checking whether every RFP requirement is addressed by a contract clause, whether every risk is mitigated, and whether there are Liquidated Damage clauses for every penalty scenario takes hours. There are always gaps.

**What this system does automatically:**
1. Reads all three documents.
2. Breaks them into typed atomic facts — Requirements, Clauses, Risks, Mitigations, LDs.
3. Builds a knowledge graph where nodes are facts and edges are relationships (COVERS, INTRODUCES_RISK, etc.).
4. Computes coverage: which requirements have NO contract clause covering them?
5. Lets you ask natural-language questions over the graph.

---

## 2. Tech Stack

| Component | Tool | Version | Role |
|-----------|------|---------|------|
| UI | Streamlit | 1.58 | Browser-based app, 5-tab workflow |
| LLM | GPT-4o (OpenAI) | gpt-4o | Extraction + Q&A synthesis |
| Graph DB | Neo4j | 5.19 | Stores nodes and typed edges, Cypher queries |
| Vector DB | Qdrant | 1.18 | Semantic search over element embeddings |
| Embeddings | BAAI/bge-m3 | — | 1024-dim multilingual dense vectors |
| Episodic Memory | Graphiti-core | — | Temporal entity graph layered on Neo4j |
| PDF parsing | PyMuPDF (fitz) | — | Extracts text page-by-page from PDFs |
| DOCX parsing | python-docx | — | Extracts paragraphs from Word files |
| Graph viz | PyVis + vis.js | — | Interactive browser-rendered graph |
| Infrastructure | Docker Compose | — | Runs Neo4j + Qdrant as local containers |

### Why Neo4j instead of a plain dict?
Neo4j is a property graph database. Relationships are first-class citizens with their own properties (confidence, evidence text). This lets us ask graph-traversal questions like "find all Requirements that have a PARTIALLY_COVERS edge from a Clause but no COVERS edge" in a single Cypher query, which would require nested loops in plain Python.

### Why Qdrant on top of Neo4j?
Neo4j stores typed structured data. Qdrant stores dense vector embeddings — numerical representations of meaning. When a user asks a question we cannot match by graph traversal (e.g. "What do we say about data sovereignty?"), we embed the question and find the most semantically similar elements using cosine similarity. The two systems complement each other.

### Why BGE-M3?
BGE-M3 (BAAI's third-generation embedding model) produces 1024-dimensional vectors, supports multilingual text, and outperforms older models like `text-embedding-ada-002` on document-level retrieval benchmarks. It runs locally — no API cost per embedding.

### Why Graphiti?
Graphiti sits on top of Neo4j as a second semantic layer. While our typed graph stores structured procurement facts, Graphiti uses GPT-4o to autonomously extract entity relationships from raw document text (episodes). It gives the Q&A service a second source of evidence when graph traversal isn't enough.

---

## 3. Project Structure

```
GraphRAG POC/
│
├── app.py                         # Streamlit entry point — mounts tabs and sidebar
├── .env                           # API keys and DB credentials (never committed)
├── docker-compose.yml             # Neo4j 5.19 + Qdrant 1.18 containers
├── requirements.txt               # All Python dependencies
│
├── config/
│   └── settings.py                # Frozen dataclass: all env vars in one place
│
├── core/                          # Pure domain — no I/O, no external deps
│   ├── models.py                  # AtomicElement, Relationship, ParsedDocument, etc.
│   ├── interfaces.py              # ABCs: IParser, IExtractor, IGraphStore, IVectorStore
│   └── exceptions.py             # ParseError, ExtractionError, GraphStoreError, etc.
│
├── parsers/
│   ├── __init__.py                # ParserFactory.get_parser(filename) → right parser
│   ├── pdf_parser.py              # PyMuPDF: page-by-page text + DocumentType inference
│   └── docx_parser.py            # python-docx: paragraph groups + DocumentType inference
│
├── extractors/
│   └── llm_extractor.py           # GPT-4o function-calling: elements + relationships
│
├── graph/
│   ├── neo4j_store.py             # Full IGraphStore impl: MERGE/MATCH Cypher queries
│   ├── builder.py                 # Orchestrates store writes + coverage/traceability queries
│   ├── graphiti_memory.py         # Graphiti episode ingestion + semantic search (async)
│   └── visualizer.py             # PyVis HTML generation: full graph + subgraph explorer
│
├── vector/
│   ├── embedder.py                # BGE-M3 lazy-loaded, normalize_embeddings=True
│   └── qdrant_store.py           # IVectorStore: upsert, search, search_by_type, clear
│
├── services/
│   ├── document_service.py        # Orchestrates parsing + extraction + SHA256 dedup
│   ├── graph_service.py           # Facade: build graph, load existing, coverage, viz
│   └── qa_service.py             # Intent classification → evidence → GPT-4o synthesis
│
├── ui/
│   ├── components/
│   │   └── sidebar.py            # Infrastructure status + Load/Clear/Wipe controls
│   └── pages/
│       ├── upload_page.py         # Tab 1: file uploader + process button
│       ├── extraction_page.py     # Tab 2: element table + relationship extractor
│       ├── graph_page.py          # Tab 3: build button + PyVis iframe
│       ├── traceability_page.py   # Tab 4: coverage table + chain detail
│       └── qa_page.py            # Tab 5: preset questions + free-text Q&A
│
└── sample_data/
    ├── rfp_acme_cloud_services.docx    # 14 RFP requirements (availability, security, perf…)
    ├── risk_rmc_cloud_services.docx    # 6 risks + 6 mitigations + 5 LDs
    └── contract_msa_cloud_services.docx # 18 clauses with deliberate gaps vs RFP
```

---

## 4. End-to-End Data Flow

```
[User uploads files]
        │
        ▼
┌─────────────────┐
│  Document       │  PyMuPDF / python-docx
│  Parsing        │  → ParsedDocument (pages[], type, name, id)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SHA-256 Hash   │  If same file was already ingested → skip this file entirely
│  Deduplication  │  (checks Neo4j Document nodes for stored hash)
└────────┬────────┘
         │ (only new files proceed)
         ▼
┌─────────────────┐
│  LLM Extraction │  GPT-4o function calling
│  (GPT-4o)       │  → AtomicElement[] (id, type, text, source, confidence)
│                 │  → Relationship[] (source_id, type, target_id, confidence, evidence)
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│  Build Knowledge Graph  (3 parallel writes)     │
│                                                 │
│  ① Neo4j     — MERGE nodes + typed edges        │
│  ② Qdrant    — embed texts → upsert vectors     │
│  ③ Graphiti  — add_episode() for each page      │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Coverage       │  Graph traversal: for each Requirement,
│  Assessment     │  find COVERS / PARTIALLY_COVERS / neither
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Q&A / Query    │  Intent → evidence (graph + vector + Graphiti) → GPT-4o answer
└─────────────────┘
```

---

## 5. Layer 1 — Document Parsing

**Files:** `parsers/pdf_parser.py`, `parsers/docx_parser.py`, `parsers/__init__.py`

### How a file becomes a ParsedDocument

`ParserFactory.get_parser(filename)` inspects the file extension:
- `.pdf` → `PDFParser` (uses PyMuPDF)
- `.docx` → `DOCXParser` (uses python-docx)
- anything else → raises `UnsupportedFileTypeError`

Each parser implements `IParser.parse(stream, filename) → ParsedDocument`.

**ParsedDocument fields:**
```python
id          # slug derived from filename: "rfp_acme_cloud_services"
name        # original filename without extension
type        # DocumentType enum: RFP | RiskSheet | Contract
pages       # list[str] — one string per page (or per 3000-char chunk for DOCX)
total_pages # len(pages)
```

### DocumentType inference (critical for extraction quality)

The `type` field is inferred from the filename using keyword matching:

| Keywords in filename | → DocumentType |
|----------------------|----------------|
| `rfp`, `rfx`, `tender` | `RFP` |
| `risk`, `rmc`, `register` | `RiskSheet` |
| `contract`, `offer`, `agreement`, `purchase` | `Contract` |
| anything else | `RFP` (default) |

**Why this matters:** The `DocumentType` is passed to GPT-4o as context. When it sees `Document type: RFP`, it knows to look for measurable obligations and label them "Requirement". When it sees `Document type: Contract`, it looks for contractual terms and labels them "Clause". **If your RFP file is not named with `rfp` or `rfx`, it will be treated as a Contract and you will get Clauses instead of Requirements.**

### PDF parsing (PyMuPDF)
```
fitz.open(stream) → iterates pages → page.get_text("text") → strips whitespace
```
Each page becomes one entry in `pages[]`. Pages shorter than 50 chars are kept (blank pages are filtered later during chunking).

### DOCX parsing (python-docx)
DOCX files have no inherent page boundaries. The parser:
1. Reads all paragraphs with `doc.paragraphs`
2. Groups them into chunks of maximum 3000 characters (from `settings.max_chunk_chars`)
3. Each chunk becomes one "synthetic page" in `pages[]`

This ensures the LLM receives manageable text blocks rather than the entire document at once.

---

## 6. Layer 2 — LLM Extraction (GPT-4o)

**File:** `extractors/llm_extractor.py`

This is the most expensive and important step. It converts raw text into typed structured facts.

### Step 1 — Chunking with overlap

Full document text = `"\n\n".join(doc.pages)`.

The text is split into overlapping chunks:
- Max chunk size: 3000 chars (`settings.max_chunk_chars`)
- Overlap: 200 chars (`settings.chunk_overlap_chars`)
- Split on sentence boundaries (`re.split(r"(?<=[.!?])\s+"`)
- Chunks shorter than 50 chars are discarded

Overlap is important because a single requirement may span a sentence boundary at a chunk edge. The 200-char overlap ensures neither chunk misses it.

### Step 2 — GPT-4o function calling (element extraction)

For each chunk, one API call is made using **OpenAI function calling** (now called "tool use"). This forces GPT-4o to return structured JSON matching our schema instead of free-form text.

**The tool schema (`ELEMENT_TOOL`) defines:**
```json
{
  "name": "extract_elements",
  "parameters": {
    "elements": [
      {
        "id": "string (e.g. REQ_001)",
        "type": "Requirement | Clause | Risk | Mitigation | LD",
        "text": "string",
        "source": "string (e.g. 'RFP Page 3')",
        "confidence": "number 0-1"
      }
    ]
  }
}
```

**The system prompt tells GPT-4o:**
- What each element type means:
  - `Requirement` — measurable obligation (SLA, deliverable) from RFP/RFX
  - `Clause` — contractual term from a contract/offer
  - `Risk` — potential negative outcome or breach
  - `Mitigation` — action to reduce a risk
  - `LD` — Liquidated Damages (financial penalty clause)
- What ID format to use: `REQ_001`, `CL_001`, `RISK_001`, `MIT_001`, `LD_001`
- Confidence rules: 0.9+ if explicitly stated, 0.7-0.9 if implied, skip below 0.7

**Elements below `settings.confidence_threshold` (default 0.6) are dropped.**

### Step 3 — Deduplication by word overlap

After all chunks are processed, elements from different chunks might describe the same fact. A deduplication pass runs:

For each pair of elements of the same type, compute **Jaccard similarity** of their word sets:
```
overlap = |words_A ∩ words_B| / |words_A ∪ words_B|
```
If overlap > 70%, keep the one with higher confidence and discard the other.

### Step 4 — Sequential ID assignment

Elements are renumbered sequentially per type:
```
REQ_001, REQ_002, … REQ_014    (Requirements from RFP)
CL_001, CL_002, … CL_018      (Clauses from Contract)
RISK_001, … RISK_006           (Risks from Risk Sheet)
MIT_001, … MIT_006             (Mitigations)
LD_001, … LD_005               (Liquidated Damages)
```

IDs are sequential within a single document processing run. The SHA-256 file hash check prevents the same document from being processed twice, which means the same IDs will not be re-generated for already-ingested files.

### Step 5 — Cross-document relationship extraction

After ALL documents are processed, a second GPT-4o call receives the full list of element IDs and their texts. It uses `RELATIONSHIP_TOOL` to infer typed directed edges:

| Relationship | Meaning |
|-------------|---------|
| `COVERS` | A Contract Clause fully addresses an RFP Requirement (same SLA or better) |
| `PARTIALLY_COVERS` | Clause addresses the topic but at a lower SLA or with missing aspects |
| `INTRODUCES_RISK` | A Requirement creates this Risk if it is breached or not met |
| `MITIGATED_BY` | A Risk is reduced by this Mitigation |
| `LINKED_TO_LD` | A Risk or Requirement has this LD as financial consequence |
| `CONTRADICTS` | Two Clauses directly conflict with each other |

Relationships below `confidence_threshold` are dropped. Relationships where either node ID is not in the current element set are also dropped (prevents hallucinated references).

---

## 7. Layer 3 — Knowledge Graph (Neo4j)

**Files:** `graph/neo4j_store.py`, `graph/builder.py`

### What gets stored in Neo4j

Every document and element becomes a **Node** with label `:Element`. Every inferred relationship becomes a **directed edge**.

**Node properties:**
```
id           — unique identifier (REQ_001, CL_003, etc.)
type         — "Document" | "Requirement" | "Clause" | "Risk" | "Mitigation" | "LD"
text         — the full text of the element
source       — human-readable location ("RFP Page 3 Section 3.1")
document_id  — which document this element came from
confidence   — float 0-1
doc_hash     — SHA-256 of file bytes (Document nodes only, for dedup)
```

**Edge types and their properties:**
```
CONTAINS        — Document → Element (structural)
COVERS          — Clause → Requirement
PARTIALLY_COVERS — Clause → Requirement
INTRODUCES_RISK — Requirement → Risk
MITIGATED_BY    — Risk → Mitigation
LINKED_TO_LD    — Risk/Requirement → LD
CONTRADICTS     — Clause → Clause

Properties on each edge: confidence (float), evidence (string justification)
```

### How nodes are written

Neo4j uses the **MERGE** command (upsert semantics):
```cypher
MERGE (e:Element {id: $id})
SET e.type = $type, e.text = $text, …
```

MERGE creates the node if it doesn't exist, or updates it if it does. This means re-running the build with the same element IDs is safe — it updates rather than duplicates.

### Constraints and indexes created at startup

```cypher
CREATE CONSTRAINT IF NOT EXISTS FOR (e:Element) REQUIRE e.id IS UNIQUE
CREATE INDEX IF NOT EXISTS FOR (e:Element) ON (e.type)
CREATE INDEX IF NOT EXISTS FOR (e:Element) ON (e.document_id)
```

The unique constraint on `id` enforces no duplicates. The type index makes `get_elements_by_type()` fast.

### What `build_from_elements` does step by step

1. `store.clear()` — deletes all nodes with `MATCH (n) DETACH DELETE n`
2. Creates a **Document pseudo-node** for each source document (type='Document', stores SHA-256 hash)
3. Writes all `AtomicElement` objects via MERGE
4. Creates `CONTAINS` edges from each Document node to its elements
5. Writes all inferred `Relationship` objects

### Key queries used at runtime

**Coverage assessment** (`assess_coverage` in `builder.py`):
```cypher
-- Full coverage (Clauses that COVER this Requirement)
MATCH (a:Element)-[r:COVERS]->(b:Element {id: $id})

-- Partial coverage
MATCH (a:Element)-[r:PARTIALLY_COVERS]->(b:Element {id: $id})

-- Risks introduced by this Requirement
MATCH (a:Element {id: $id})-[r:INTRODUCES_RISK]->(b:Element)
```

**Traceability chain** — runs multiple queries in sequence to build the full chain for one requirement: full coverage → partial coverage → risks → mitigations per risk → LDs.

---

## 8. Layer 4 — Vector Store (Qdrant + BGE-M3)

**Files:** `vector/embedder.py`, `vector/qdrant_store.py`

### Why we need vectors if we have Neo4j

Neo4j answers precise graph questions: "which Requirements have no COVERS edge?" It cannot answer fuzzy semantic questions: "what do we say about data sovereignty?" — because "data sovereignty" and "data residency in the EEA" are semantically similar but share no keywords.

Qdrant stores **dense vector representations** (embeddings) of every element's text. When a user asks a free-form question, it is embedded into the same 1024-dimensional space and the closest elements are found by cosine similarity.

### BGE-M3 embedding

`BGEEmbedder` lazy-loads the `BAAI/bge-m3` model on first use via `sentence-transformers`:
```python
SentenceTransformer("BAAI/bge-m3", normalize_embeddings=True)
```

`normalize_embeddings=True` ensures every vector has L2-norm = 1. This makes cosine similarity equivalent to dot product, which is faster.

The model runs on CPU (or MPS/CUDA if available) and produces a 1024-float list per text.

### Qdrant collection and point structure

Collection is created on first startup:
```
name: "graphrag_elements" (from settings)
vector size: 1024
distance: COSINE
```

Each element becomes one **Qdrant point**:
```
id      — uint64 derived from element_id string via abs(hash(id)) % 2^63
vector  — 1024-float BGE-M3 embedding
payload — {element_id, type, text, source, document_id, confidence}
```

The payload is stored alongside the vector so we can reconstruct the `AtomicElement` object from search results without querying Neo4j.

### Search flow

```python
query → BGE-M3.embed_one(query) → 1024-float vector
→ qdrant.query_points(collection, query_vector, limit=5)
→ response.points → reconstruct AtomicElement objects
```

An in-memory `_cache` dict (`element_id → AtomicElement`) is checked first. Cache hits return the exact original object (with embedding populated). Cache misses reconstruct from the Qdrant payload.

### Filtered search

`search_by_type()` adds a Qdrant payload filter:
```python
Filter(must=[FieldCondition(key="type", match=MatchValue(value="Requirement"))])
```
This lets the Q&A service search only among Clauses, or only among Risks, depending on the question context.

---

## 9. Layer 5 — Episodic Memory (Graphiti)

**File:** `graph/graphiti_memory.py`

### What Graphiti adds on top of Neo4j

Graphiti is an open-source library that builds a **temporal entity graph** from unstructured text. It uses GPT-4o to:
1. Extract entities and facts from raw document text ("episodes")
2. Store them as nodes/edges in the **same** Neo4j database (different node labels: Entity, Episodic, Relation)
3. Maintain temporal validity: facts can be valid between timestamps

Our typed procurement graph (Requirements, Clauses etc.) stays separate from Graphiti's entity layer. Both share the same Neo4j but use different node labels. Graphiti adds a semantic enrichment layer that can answer questions our typed schema cannot.

### Episode ingestion

For each document, each page (or DOCX chunk) is sent to Graphiti as one **episode**:
```python
await client.add_episode(
    name="RFP — Page 3",
    episode_body="<raw page text>",
    source=EpisodeType.text,
    source_description="RFP document: rfp_acme_cloud_services",
    reference_time=datetime.now(timezone.utc),
)
```

Graphiti internally calls GPT-4o to extract entities and relationships from the episode text and writes them to Neo4j as Entity/RELATES_TO nodes.

### Why Graphiti failures are non-blocking

Graphiti ingestion runs after the Neo4j and Qdrant writes. Failures are caught and logged as warnings. The core procurement graph and vector index are already complete — Graphiti is an enhancement, not a requirement. If Graphiti fails for any episode, the system continues normally.

### Event loop management

Streamlit's script runner thread has no asyncio event loop. Python 3.12+ raises a `RuntimeError` if you call `asyncio.get_event_loop()` from a non-main thread. The `_run_async()` helper handles this:

```python
def _run_async(self, coro, timeout=120):
    try:
        asyncio.get_running_loop()  # raises RuntimeError if no loop exists
        # There IS a running loop (e.g. Jupyter) — run in a worker thread
        self._client = None  # reset because client is bound to its creation loop
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result(timeout=timeout)
    except RuntimeError:
        # No running loop (normal Streamlit case) — safe to use asyncio.run()
        self._client = None
        return asyncio.run(coro)
```

`self._client = None` is reset before each call because the Graphiti client holds an internal reference to the event loop that created it. Reusing the client across loops raises "Event loop is closed". Resetting forces a fresh client creation bound to the new loop.

---

## 10. Tab 1 — Upload Documents

**File:** `ui/pages/upload_page.py`  
**Service:** `DocumentService` (`services/document_service.py`)

### What the user sees
A drag-and-drop file uploader accepting `.pdf` and `.docx`. A summary table shows each file's detected type, format, and size. A "Process Documents" button triggers extraction.

### What happens when "Process Documents" is clicked

**Step 1 — Read file bytes**
```python
file_list = [(f.read(), f.name) for f in uploaded]
```
Streamlit's `UploadedFile` objects are not seekable after a rerun, so all bytes are read eagerly before any processing.

**Step 2 — Check existing hashes (dedup)**
```python
existing_hashes = get_graph_service().get_ingested_doc_hashes()
```
This queries Neo4j for SHA-256 hashes stored on all Document nodes. Returns a dict like `{"rfp_acme_cloud_services": "a3f7..."}`.

**Step 3 — Process only new files**
```python
docs, elements, new_hashes = ds.process_files(file_list, existing_hashes=existing_hashes)
```

For each file:
- Compute `sha256(file_bytes)`.
- If that hash is already in `existing_hashes` values → skip this file (already in graph).
- Otherwise → parse + extract → add to results.

**Step 4 — Save to session state**
```python
st.session_state["parsed_docs"]   = docs
st.session_state["elements"]      = elements
st.session_state["doc_hashes"]    = new_hashes   # used later to store in Neo4j
st.session_state["relationships"] = []
st.session_state["graph_built"]   = False
st.session_state["coverage_results"] = []
```

Clearing `graph_built` and `coverage_results` forces the user to rebuild the graph — the new elements need to be written to Neo4j before traceability queries work.

### Important: filename affects extraction quality

The filename determines the `DocumentType` which is passed to GPT-4o. Name your files with these keywords:
- RFP: use `rfp`, `rfx`, or `tender` in the filename
- Risk Sheet: use `risk`, `rmc`, or `register`
- Contract: use `contract`, `offer`, `agreement`, or `purchase`

---

## 11. Tab 2 — Extract Elements

**File:** `ui/pages/extraction_page.py`  
**Service:** `DocumentService.extract_cross_document_relationships()`

### What the user sees

A metric row showing counts by type (Requirements, Clauses, Risks, Mitigations, LDs). A filterable table of all extracted elements. A button to extract cross-document relationships.

### The elements table

Displays: ID, Type, Text (first 120 chars), Source (page/section), Confidence, Document.

The "Confidence" column renders as a progress bar (0–1). Elements with confidence below 0.6 were already filtered during extraction and will never appear here.

### "Extract Cross-Document Relationships" button

This triggers a **single GPT-4o call** with the full element list (all documents combined).

Why a separate step? Element extraction happens per-document, per-chunk. At that point GPT-4o can only see one small text chunk. Cross-document relationships (e.g. "CL_003 COVERS REQ_007" where REQ_007 is from the RFP and CL_003 is from the contract) require seeing all elements together. That's why this is a separate API call after all documents are processed.

The relationship types returned:
```
COVERS, PARTIALLY_COVERS, INTRODUCES_RISK, MITIGATED_BY, LINKED_TO_LD, CONTRADICTS
```

Results are stored in `st.session_state["relationships"]`.

---

## 12. Tab 3 — Knowledge Graph

**File:** `ui/pages/graph_page.py`  
**Service:** `GraphService.build_knowledge_graph()`

### What the user sees

Before building: a single "Build Knowledge Graph" button with a description.

After building: a stats row (nodes, edges, elements), a checkbox to toggle CONTAINS edges, a full interactive graph, and a Subgraph Explorer.

### What "Build Knowledge Graph" does

Calls `GraphService.build_knowledge_graph(docs, elements, rels, doc_hashes)`:

**① Neo4j write** (`GraphBuilder.build_from_elements`):
1. `store.clear()` — wipes all nodes and edges (fresh build semantics)
2. Create Document pseudo-nodes (with SHA-256 hash stored on the node)
3. `store.add_element(elem)` for each element → MERGE node
4. Add CONTAINS edges (Document → Element)
5. Add all inferred typed relationships

**② Qdrant write**:
```python
vector_store.upsert(elements)
```
Encodes all element texts with BGE-M3 and upserts as points. On re-ingestion of the same elements, Qdrant upsert is idempotent (same point ID = update not duplicate).

**③ Graphiti write** (non-blocking):
For each document, each page is sent to Graphiti as an episode. Failures are logged as warnings, not errors.

### The interactive graph

The visualizer (`graph/visualizer.py`) queries Neo4j for all nodes and edges, builds a PyVis `Network` object, and returns a self-contained HTML string.

The HTML is base64-encoded into a `data:text/html;base64,...` URL and rendered in `st.iframe`. This is required because `st.iframe` only accepts URLs, not raw HTML strings.

CSS is injected to remove the default browser body margin (`margin:0; padding:0`), which would otherwise clip the vis.js navigation buttons (zoom in/out, fit to screen) at the bottom of the canvas.

**Node colours:**
```
Blue     — Document
Green    — Requirement
Orange   — Clause
Red      — Risk
Purple   — Mitigation
Teal     — LD (Liquidated Damages)
```

**Edge colours:**
```
Grey     — CONTAINS
Green    — COVERS
Orange   — PARTIALLY_COVERS
Red      — INTRODUCES_RISK
Purple   — MITIGATED_BY
Teal     — LINKED_TO_LD
Dark red — CONTRADICTS
```

### Subgraph Explorer

Enter any node ID (e.g. `REQ_001`) to see its ego-network — the node and all nodes within 2 hops. Uses BFS over the undirected adjacency of the full graph to collect the neighbourhood, then renders only those nodes and the edges between them.

---

## 13. Tab 4 — Inter-Document Traceability

**File:** `ui/pages/traceability_page.py`  
**Service:** `GraphService.get_coverage_results()` → `GraphBuilder.assess_coverage()`

### What the user sees

Four summary metrics (Total Requirements, Covered, Partially Covered, Not Covered). A progress bar showing the coverage score. A full table with one row per requirement. A Traceability Chain Detail section for deep-dive on individual requirements.

### How coverage is computed

`assess_coverage()` iterates every Requirement node in Neo4j and for each one runs:

```
1. Find incoming COVERS edges       → full_coverage list
2. Find incoming PARTIALLY_COVERS   → partial_coverage list
3. Find outgoing INTRODUCES_RISK    → risks list
4. For each risk: find MITIGATED_BY → mitigations list
5. Find LINKED_TO_LD on req + risks → lds list

Then:
if full_coverage    → CoverageStatus.COVERED
elif partial_coverage → CoverageStatus.PARTIAL
else                → CoverageStatus.NOT_COVERED
```

### Coverage score formula

```
score = (covered + partial × 0.5) / total_requirements
```

A partially-covered requirement counts as half a coverage unit.

### Auto-recompute on page load

If `graph_built = True` but `coverage_results` is empty in session (e.g. after a page refresh), the traceability page automatically calls `get_coverage_results()` from Neo4j. This avoids the need to click "Build" again.

### Traceability Chain Detail

Selecting a requirement from the dropdown calls `GraphService.get_traceability(req_id)` which runs the same queries as `assess_coverage` but for a single requirement and returns the full chain dict:
```python
{
  "requirement":      {id, type, text, source, confidence},
  "full_coverage":    ["CL_003", "CL_007"],
  "partial_coverage": ["CL_011"],
  "risks":            ["RISK_002"],
  "mitigations":      ["MIT_002"],
  "lds":              ["LD_003"],
  "gaps":             ["Risks [RISK_002] have no Liquidated Damages"]
}
```

Gaps are computed as:
- No coverage at all → "No contract clause covers this requirement"
- Risks exist but no mitigations → "Risks [X] have no mitigation"
- Risks exist but no LDs → "Risks [X] have no Liquidated Damages"

### "No Requirements found" diagnostic

If `assess_coverage()` returns an empty list, the page shows a type breakdown of what IS in Neo4j (e.g. `Clause: 18, Risk: 6, Document: 3`). The most common cause is a filename without `rfp`/`rfx`/`tender`, causing the parser to infer the wrong DocumentType and GPT-4o to extract Clauses instead of Requirements.

---

## 14. Tab 5 — Ask Questions (Q&A)

**File:** `ui/pages/qa_page.py`  
**Service:** `QAService` (`services/qa_service.py`)

### What the user sees

Four preset question buttons for the most common procurement queries. A free-text input field. A Q&A history that accumulates across the session (newest first). Each answer shows the evidence used to generate it.

### How a question is answered

`QAService.answer(question)` runs a 3-step pipeline:

#### Step 1 — Intent classification

A rule-based keyword classifier routes the question to one of 5 paths:

| Keywords | Intent |
|----------|--------|
| "not covered", "uncovered", "gap" | `coverage_gap` |
| "risk" + "partial" | `risk_for_partial` |
| "no mitigation", "unmitigated" | `no_mitigation` |
| "no ld", "no liquidated", "no penalty" | `no_ld` |
| anything else | `general` |

Why rule-based and not another LLM call? Speed and cost. Intent classification with LLM would add ~500ms and another API call. The keyword heuristic is accurate for the narrow domain of procurement Q&A.

#### Step 2 — Evidence gathering per intent

**`coverage_gap`:**  
Calls `assess_coverage()` → filters to `status == NOT_COVERED` → returns id, text, source for each uncovered requirement.

**`risk_for_partial`:**  
Calls `assess_coverage()` → filters to `status == PARTIAL` → for each partial requirement, fetches its associated Risk nodes from Neo4j.

**`no_mitigation`:**  
Gets all Risk nodes from Neo4j → for each, checks if any outgoing edge has type `MITIGATED_BY` → returns risks with no such edge.

**`no_ld`:**  
Same pattern but checks for `LINKED_TO_LD` edges.

**`general`:**  
Two-stream evidence gathering:
1. **Qdrant vector search** — embed the question with BGE-M3 → retrieve top 5 most similar elements by cosine similarity
2. **Graphiti entity search** — search Graphiti's entity graph for relevant facts

The two streams are concatenated into one evidence list.

#### Step 3 — GPT-4o synthesis

The evidence list (JSON-serialised) and the original question are sent to GPT-4o with a system prompt:
```
"You are a procurement knowledge graph analyst.
Answer based only on the provided graph evidence.
Always cite element IDs and source pages.
Be concise and precise."
```

GPT-4o produces a natural-language answer grounded in the evidence. It cannot hallucinate facts not in the evidence because the system prompt explicitly restricts it to the provided data.

### Evidence panel

Each answer card has an expandable "Evidence" panel showing the raw evidence list as a dataframe. The `query_type` field shows which intent path was taken (useful for debugging why a question gave a certain answer).

---

## 15. Sidebar

**File:** `ui/components/sidebar.py`

### Infrastructure Status

On every page load, the sidebar makes two quick health-check connections:
- **Neo4j**: Opens a session and runs `MATCH (e:Element) RETURN count(e)`. Shows the live node count.
- **Qdrant**: Calls `client.get_collections()`. Shows connected or error.

### "Load from Graph" (appears when DB has data but session is empty)

Shown when Neo4j has nodes but `session_state["elements"]` is empty — the most common scenario after an app restart or page refresh.

Calls `GraphService.load_existing_data()`:
```python
elements = store.get_all_elements()   # MATCH (e:Element) WHERE e.type <> 'Document'
coverage = builder.assess_coverage()  # runs the full coverage computation
```

Sets `session_state["elements"]`, `session_state["coverage_results"]`, `session_state["graph_built"] = True`. The user can then jump directly to Tab 4 or Tab 5 without re-uploading files.

### "Clear UI State"

Clears session variables only (`elements`, `parsed_docs`, `relationships`, `coverage_results`, `chat_history`, `doc_hashes`). Sets `graph_built = False`.

**Neo4j and Qdrant are untouched.** Data in the databases is preserved. The user can immediately click "Load from Graph" to restore the session without re-processing files.

### "Wipe Database" (with confirmation)

Shows a warning and two confirmation buttons. On confirm:
```python
GraphService.reset_graph()
→ store.clear()        # MATCH (n) DETACH DELETE n in Neo4j
→ vector_store.clear() # delete_collection + recreate in Qdrant
```

This is irreversible. All extracted elements, relationships, and vectors are permanently deleted. Files must be re-uploaded and re-processed.

---

## 16. Persistence, Session State and Reset

### Three layers of state

| Layer | Where | Persists across |
|-------|-------|-----------------|
| In-memory session | `st.session_state` | Tab navigation only |
| Graph database | Neo4j | App restarts, server reboots |
| Vector index | Qdrant | App restarts, server reboots |

### Streamlit session_state keys

| Key | Type | Content |
|-----|------|---------|
| `uploaded_files` | list | Raw UploadedFile objects (not persisted after rerun) |
| `parsed_docs` | list[ParsedDocument] | Parsed document objects |
| `elements` | list[AtomicElement] | All extracted elements from current session |
| `relationships` | list[Relationship] | Cross-document relationships |
| `doc_hashes` | dict[str,str] | `{doc_id: sha256}` for docs processed this run |
| `graph_built` | bool | Whether Neo4j/Qdrant have been written this session |
| `coverage_results` | list[CoverageResult] | Coverage assessment results |
| `chat_history` | list[dict] | Q&A history (newest first) |
| `processing` | bool | Lock flag to prevent double-click processing |

### Startup auto-restore

Every Streamlit page load runs `app.py` from top to bottom. The `_DEFAULTS` dict initialises missing session keys. The sidebar renders and checks Neo4j. If Neo4j has nodes but `elements` is empty, the "Load from Graph" button appears automatically.

### `@st.cache_resource`

`get_graph_service()` and `get_doc_service()` are decorated with `@st.cache_resource`. This caches the service **instances** (not their return values) across reruns for the lifetime of the Python process. The Neo4j driver connection pool and BGE-M3 model are expensive to recreate. If you update the code, you must **restart the Streamlit server** — a browser refresh alone will serve the old cached instance without the new methods.

---

## 17. Duplicate Detection

### File-level dedup (primary protection)

Before any parsing or LLM calls, `DocumentService.process_files()` computes `sha256(file_bytes)` for each uploaded file and checks it against hashes stored in Neo4j's Document nodes.

If the hash is already known → the file is skipped entirely. No parsing, no GPT-4o calls, no cost.

The hash is stored on the Document node in Neo4j when `build_from_elements` creates the Document pseudo-node.

### Sequential IDs + MERGE (secondary protection)

Even if the same file somehow bypasses the hash check, Neo4j's MERGE semantics mean writing a node with an existing ID updates rather than duplicates it. Since sequential IDs are assigned per extraction run from the same document, the same document → same IDs → MERGE updates.

---

## 18. Configuration Reference

All settings live in `config/settings.py` and are read from environment variables (`.env` file).

| Variable | Default | Effect |
|----------|---------|--------|
| `OPENAI_API_KEY` | (required) | Used for all GPT-4o extraction and Q&A calls |
| `LLM_MODEL` | `gpt-4o` | Change to `gpt-4o-mini` to reduce cost during development |
| `MAX_TOKENS_EXTRACTION` | `4000` | Max tokens per element extraction API call |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` | Local sentence-transformers model |
| `EMBEDDING_DIMENSION` | `1024` | Must match the model's output dimension |
| `QDRANT_HOST` | `localhost` | Qdrant server hostname |
| `QDRANT_PORT` | `6333` | Qdrant REST port |
| `QDRANT_COLLECTION` | `graphrag_elements` | Collection name in Qdrant |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j Bolt connection string |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `password` | Neo4j password (set in docker-compose.yml) |
| `NEO4J_DATABASE` | `neo4j` | Neo4j database name |
| `CONFIDENCE_THRESHOLD` | `0.6` | Elements and relationships below this are dropped |
| `MAX_CHUNK_CHARS` | `3000` | Max characters per text chunk sent to GPT-4o |
| `CHUNK_OVERLAP_CHARS` | `200` | Overlap between consecutive chunks |

---

## 19. Error Reference

### "No Requirements found in the graph"

**Cause:** `get_elements_by_type(ElementType.REQUIREMENT)` returned empty.  
**Most common reason:** The RFP filename does not contain `rfp`, `rfx`, or `tender`. The parser classified it as Contract or Unknown, GPT-4o extracted Clauses instead of Requirements.  
**Fix:** Rename the file to include `rfp` (e.g. `rfp_project.docx`), wipe the database, re-ingest.

### "All uploaded files were already ingested"

**Cause:** SHA-256 hash of the uploaded file matches a hash stored in Neo4j.  
**This is expected behaviour** — the file was already ingested in a previous run.  
**If you want to re-extract:** Wipe the database first (sidebar → "Wipe Database"), then re-upload.

### "Load failed: GraphService has no attribute X"

**Cause:** `@st.cache_resource` is serving a stale instance created before the code change.  
**Fix:** Stop and restart the Streamlit server (`Ctrl+C` then `.venv/bin/streamlit run app.py`). A browser refresh is not enough.

### Graphiti "EquivalentSchemaRuleAlreadyExists" errors

**Cause:** Graphiti calls `build_indices_and_constraints()` on every startup. Neo4j 5.x throws this error even with `IF NOT EXISTS`. The indexes are already there and working.  
**Impact:** None. These are suppressed by the `_IgnoreEquivalentSchema` log filter in `graphiti_memory.py`.

### Graphiti "missing 1 required positional argument: reference_time"

**Cause:** graphiti-core updated its `add_episode()` API to require a `reference_time` datetime.  
**Fix:** Already applied — `graphiti_memory.py` now passes `reference_time=datetime.now(timezone.utc)`.

### Graph visualization shows only dark background

**Cause:** `st.html()` sandboxes JavaScript — vis.js never executes.  
**Fix:** Already applied — the visualizer uses `st.iframe(data:text/html;base64,...)`. The HTML is base64-encoded to create a proper iframe URL where scripts execute normally.

### Qdrant "Client has no attribute search"

**Cause:** qdrant-client 1.9+ removed `.search()` in favour of `.query_points()`.  
**Fix:** Already applied — `qdrant_store.py` uses `client.query_points()` and reads results from `response.points`.

---

*Last updated: 2026-06-26 — covers all code changes made through this session.*
