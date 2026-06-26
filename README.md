# GraphRAG POC — Knowledge Mapping

> **Convert procurement documents into a queryable knowledge graph.**
> Upload RFP + Risk Sheet + Contract → extract atomic elements → build a graph → trace coverage → ask questions in plain English.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Configuration Reference](#configuration-reference)
5. [Project Structure](#project-structure)
6. [How the Demo Works](#how-the-demo-works)
7. [Continuing Development](#continuing-development)
8. [Troubleshooting](#troubleshooting)

---

## What This Does

This POC proves that procurement document intelligence can be fully automated using a production-grade knowledge graph pipeline.

| Input | Output |
|-------|--------|
| RFP / RFX (PDF or DOCX) | Typed `Requirement` nodes |
| Risk Sheet (PDF or DOCX) | Typed `Risk` + `Mitigation` nodes |
| Contract / Offer (PDF or DOCX) | Typed `Clause` + `LD` nodes |

All nodes land in **Neo4j**. Typed edges (`COVERS`, `INTRODUCES_RISK`, `MITIGATED_BY`, `LINKED_TO_LD`, …) connect them across documents. You can then:

- See a live interactive graph (PyVis)
- Get a traceability matrix — which requirements are covered, partial, or missing
- Ask natural language questions — answered by graph traversal + semantic search, cited to exact pages

**Tech stack at a glance**

| Role | Technology |
|------|-----------|
| LLM extraction | GPT-4o (OpenAI function calling) |
| Graph store | Neo4j 5.x |
| Graph memory | Graphiti-core (episodic memory on Neo4j) |
| Vector store | Qdrant |
| Embeddings | BAAI/bge-m3 (sentence-transformers) |
| UI | Streamlit |

---

## Prerequisites

### 1. System requirements

| Tool | Minimum version | Check |
|------|----------------|-------|
| Python | 3.11+ | `python3 --version` |
| Docker Desktop | 4.x | `docker --version` |
| Docker Compose | v2 | `docker compose version` |

> **macOS / Linux only tested.** Windows works via WSL2 with Docker Desktop.

### 2. API keys

You need one API key:

| Service | Where to get it | Required? |
|---------|----------------|-----------|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | **Yes** — used for GPT-4o extraction and Q&A |

> GPT-4o costs approximately **$0.01–0.05 per document** for extraction depending on length.

### 3. Ports that must be free

| Port | Used by |
|------|--------|
| `7474` | Neo4j browser (optional, for debugging) |
| `7687` | Neo4j Bolt driver |
| `6333` | Qdrant REST API |
| `6334` | Qdrant gRPC |
| `8501` | Streamlit UI |

---

## Quick Start

### Step 1 — Clone / download

```bash
cd ~/Desktop
# If using git:
git clone <repo-url> "GraphRAG POC"
cd "GraphRAG POC"
```

### Step 2 — Set your API key

```bash
cp .env.example .env
```

Open `.env` and set your key:

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
```

Everything else in `.env` has working defaults — leave them unless you need custom ports or passwords.

### Step 3 — Start Neo4j and Qdrant

```bash
docker compose up -d
```

Wait ~20 seconds for both services to be healthy:

```bash
docker compose ps
# Both should show "healthy" or "running"
```

> **Neo4j browser** is available at http://localhost:7474 (user: `neo4j`, password: `password`) — useful for debugging the graph directly.

### Step 4 — Create virtual environment and install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

> First run downloads the BGE-M3 embedding model (~2 GB). This happens once and is cached locally by Hugging Face.

### Step 5 — Run the app

```bash
.venv/bin/streamlit run app.py
# or with venv activated:
streamlit run app.py
```

Open **http://localhost:8501** in your browser.

---

## Configuration Reference

All settings live in `.env`. The full reference:

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

### Switching to a cheaper model for development

```env
LLM_MODEL=gpt-4o-mini
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

`all-MiniLM-L6-v2` is 90 MB vs 2 GB for BGE-M3. Good enough for testing extraction logic.

---

## Project Structure

```
GraphRAG POC/
│
├── app.py                          ← Streamlit entry point (thin orchestrator)
├── requirements.txt
├── .env.example                    ← Copy to .env and fill in keys
├── docker-compose.yml              ← Neo4j 5.19 + Qdrant
│
├── config/
│   └── settings.py                 ← All env vars loaded here as frozen dataclass
│
├── core/                           ← Pure domain — no I/O, no framework deps
│   ├── models.py                   ← AtomicElement, Relationship, ParsedDocument, CoverageResult
│   ├── interfaces.py               ← IParser, IExtractor, IGraphStore, IVectorStore (ABCs)
│   └── exceptions.py               ← Typed exception hierarchy
│
├── parsers/                        ← Text extraction only
│   ├── __init__.py                 ← ParserFactory.get_parser(filename)
│   ├── pdf_parser.py               ← PyMuPDF
│   └── docx_parser.py              ← python-docx
│
├── extractors/
│   ├── __init__.py
│   └── llm_extractor.py            ← GPT-4o function calling → AtomicElement + Relationship
│
├── graph/
│   ├── __init__.py
│   ├── neo4j_store.py              ← IGraphStore on Neo4j (Cypher MERGE / MATCH)
│   ├── graphiti_memory.py          ← Graphiti episodic memory layer (async + sync wrappers)
│   ├── builder.py                  ← GraphBuilder: build, assess_coverage, traceability chain
│   └── visualizer.py               ← PyVis HTML generator
│
├── vector/
│   ├── __init__.py
│   ├── embedder.py                 ← BGEEmbedder (lazy-loads BAAI/bge-m3)
│   └── qdrant_store.py             ← IVectorStore on Qdrant
│
├── services/                       ← Orchestration — the only layer app.py talks to
│   ├── __init__.py
│   ├── document_service.py         ← parse + extract pipeline
│   ├── graph_service.py            ← Neo4j + Qdrant + Graphiti build pipeline
│   └── qa_service.py               ← intent detection → graph traversal + synthesis
│
└── ui/
    ├── components/
    │   └── sidebar.py              ← Infrastructure status + session controls
    └── pages/
        ├── upload_page.py          ← Step 1: file upload + GPT-4o extraction trigger
        ├── extraction_page.py      ← Step 2: elements table + relationship extraction
        ├── graph_page.py           ← Step 3: build graph + PyVis visualization
        ├── traceability_page.py    ← Step 4: coverage matrix + traceability chain
        └── qa_page.py              ← Step 5: NL Q&A with chat history
```

---

## How the Demo Works

### The 5-step flow

```
Upload  →  Extract  →  Build Graph  →  Traceability  →  Ask
 PDF        GPT-4o      Neo4j +          Coverage         NL Q&A
 DOCX       func call   Graphiti         matrix           GPT-4o
```

**Step 1 — Upload**
Drop in up to 3 files. Name them with keywords for auto-detection:
- `*rfp*`, `*rfx*`, `*tender*` → RFP
- `*risk*`, `*rmc*`, `*register*` → Risk Sheet
- `*contract*`, `*offer*`, `*agreement*` → Contract

**Step 2 — Extract**
Clicks "Process Documents": GPT-4o reads each file in chunks and calls a typed function schema to return `Requirement`, `Clause`, `Risk`, `Mitigation`, `LD` elements. Then "Extract Relationships" infers `COVERS`, `INTRODUCES_RISK`, `MITIGATED_BY`, etc. across all documents.

**Step 3 — Build Graph**
Nodes go into Neo4j. Vectors go into Qdrant. Document pages go into Graphiti as episodes. The interactive PyVis graph appears — hover nodes for details, click edges for relationship info.

**Step 4 — Traceability**
Every `Requirement` gets a coverage verdict: ✅ Covered / ⚠️ Partial / ❌ Not Covered. Click any row to expand its full traceability chain (requirement → clause → risk → mitigation → LD) and see identified gaps.

**Step 5 — Ask**
Type any question. The QAService classifies intent and runs the right strategy:
- Coverage gaps → Cypher graph traversal
- Risk questions → multi-hop Cypher
- Open questions → BGE-M3 vector search + Graphiti semantic search + GPT-4o synthesis

---

## Continuing Development

### Adding a new parser (e.g. Excel, plain text)

1. Create `parsers/excel_parser.py` implementing `IParser` from `core/interfaces.py`
2. Register it in `parsers/__init__.py`:

```python
from .excel_parser import ExcelParser

class ParserFactory:
    _parsers = [PDFParser(), DOCXParser(), ExcelParser()]   # add here
```

No other files need to change.

### Adding a new element type

1. Add the value to `ElementType` enum in `core/models.py`
2. Update the `extract_elements` system prompt in `extractors/llm_extractor.py` to describe the new type
3. Add the ID prefix mapping in `_type_str_to_enum` and `prefix_map` inside `LLMExtractor`

### Adding a new relationship type

1. Add the value to `RelationshipType` enum in `core/models.py`
2. Update the `RELATIONSHIP_TOOL` enum list in `extractors/llm_extractor.py`
3. Update the system prompt in `extract_relationships()` to describe the new type
4. Neo4j handles dynamic relationship types — no schema migration needed

### Changing the LLM

Settings-driven — just change `.env`:

```env
LLM_MODEL=gpt-4o-mini    # cheaper, faster
```

The `LLMExtractor` uses whatever `settings.llm_model` returns.

### Swapping Neo4j for another graph store

1. Create `graph/your_store.py` implementing `IGraphStore` from `core/interfaces.py`
2. In `graph/__init__.py` swap the import
3. In `services/graph_service.py` change `Neo4jGraphStore()` to `YourStore()`

### Adding a new Q&A intent

In `services/qa_service.py`:

1. Add keyword detection in `_classify_intent()`
2. Add a `_gather_<intent>_evidence()` method with the Cypher/vector query
3. Map the new intent in `answer()`

### Running tests (when added)

```bash
# Unit tests (no infra needed)
.venv/bin/pytest tests/unit/

# Integration tests (needs docker compose up first)
.venv/bin/pytest tests/integration/
```

### Useful debug endpoints

| URL | What it shows |
|-----|--------------|
| http://localhost:7474 | Neo4j Browser — run Cypher directly |
| http://localhost:6333/dashboard | Qdrant dashboard |
| http://localhost:6333/collections | Qdrant collections JSON |

**Useful Cypher queries for debugging in Neo4j browser:**

```cypher
// See all nodes and relationships
MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 50

// Count by type
MATCH (e:Element) RETURN e.type, count(e) ORDER BY count(e) DESC

// Trace a specific requirement
MATCH path = (req:Element {id: 'REQ_001'})-[*1..3]-(related)
RETURN path

// Find all uncovered requirements
MATCH (req:Element {type: 'Requirement'})
WHERE NOT (req)<-[:COVERS]-() AND NOT (req)<-[:PARTIALLY_COVERS]-()
RETURN req.id, req.text
```

---

## Troubleshooting

### "Neo4j: Connection refused"

Docker container is not running or still starting.

```bash
docker compose ps          # check status
docker compose logs neo4j  # check for errors
docker compose up -d       # restart if needed
```

Wait ~20 seconds after starting for Neo4j to be fully ready.

### "Qdrant: Connection refused"

```bash
docker compose logs qdrant
docker compose up -d qdrant
```

### "OPENAI_API_KEY is not set"

Make sure you copied `.env.example` to `.env` and set your key:

```bash
cp .env.example .env
# open .env and set OPENAI_API_KEY=sk-proj-...
```

### BGE-M3 model download is slow / fails

The model downloads from Hugging Face on first run (~2 GB). If it fails:

```bash
# Pre-download manually
.venv/bin/python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"
```

Or switch to a smaller model in `.env`:

```env
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### "No elements extracted"

- Check your OpenAI API key has credits
- The document might be image-based (scanned PDF) — PyMuPDF cannot extract text from scanned images. Use a text-based PDF or DOCX.
- Lower `CONFIDENCE_THRESHOLD=0.4` in `.env` to be more permissive

### Graph visualization is blank

The graph may be empty if element extraction produced no results, or if the build step was skipped. Click "Reset Session" in the sidebar and redo from Step 1.

### Port conflicts

If any port is already in use:

```bash
# Find what's using port 7687
lsof -i :7687

# Edit docker-compose.yml to use different ports, e.g. 7688:7687
# Then update .env: NEO4J_URI=bolt://localhost:7688
```

---

## Stopping the Services

```bash
# Stop containers (data preserved in Docker volumes)
docker compose stop

# Stop and remove containers + volumes (full reset)
docker compose down -v
```

---

## Phase 2 — Offer Generation (Planned)

The current POC covers knowledge extraction and coverage assessment. Phase 2 will add:

- **Clause recommendation** — suggest contract clauses that would cover uncovered requirements
- **Offer generation** — draft a response offer for a selected RFP requirement using traced clauses as templates
- **Gap remediation** — auto-suggest mitigations for unmitigated risks

These build directly on the graph already constructed in Phase 1.
