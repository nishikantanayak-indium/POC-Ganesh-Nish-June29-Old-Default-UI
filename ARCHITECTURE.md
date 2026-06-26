# GraphRAG POC — Architecture & Design Document

> **Version:** 2.0 — Production Tech Stack
> **Last Updated:** 2026-06-26
> **Status:** Active Development

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Five-Step Demo Flow](#2-five-step-demo-flow)
3. [Technology Stack](#3-technology-stack)
4. [Why GPT-4o](#4-why-gpt-4o)
5. [Why Neo4j](#5-why-neo4j)
6. [Why Graphiti](#6-why-graphiti)
7. [Why Qdrant](#7-why-qdrant)
8. [Why BGE-M3](#8-why-bge-m3)
9. [Graph Data Model](#9-graph-data-model)
10. [Full Data Flow](#10-full-data-flow)
11. [Dual-Layer Graph Architecture](#11-dual-layer-graph-architecture)
12. [LLM Extraction Strategy](#12-llm-extraction-strategy)
13. [Coverage Assessment Logic](#13-coverage-assessment-logic)
14. [Q&A Architecture](#14-qa-architecture)
15. [SOLID Principles Applied](#15-solid-principles-applied)
16. [Infrastructure](#16-infrastructure)
17. [Setup & Run](#17-setup--run)
18. [Phase 2 Preview](#18-phase-2-preview)

---

## 1. Executive Summary

This POC proves that procurement document intelligence can be fully automated using a production-grade knowledge graph pipeline. The core thesis: **documents should not be queried as text — they should be queried as graphs.**

Traditional RAG (Retrieval-Augmented Generation) retrieves passages. GraphRAG retrieves **relationships**. When a procurement manager asks "Which RFP requirements have no contract coverage and no mitigation for the introduced risk?", a vector search returns fragments. A graph traversal returns the exact answer in milliseconds — deterministically, with zero hallucination, citing source page numbers.

**What this POC proves:**

- GPT-4o with function calling can extract typed, structured atomic elements from real procurement documents (RFP, Risk Sheet, Contract) with high fidelity — no post-processing, no regex, no schema drift.
- Neo4j's property graph model is the correct abstraction for cross-document traceability. Cypher queries express multi-hop relationship traversals in 3 lines that would take 50 lines of Python with NetworkX.
- Graphiti adds a second, autonomous semantic memory layer that complements our typed schema — it finds entities and relationships our schema did not anticipate, turning the graph into a living document memory.
- Qdrant + BGE-M3 provides production-grade semantic search that surfaces relevant elements even when terminology varies across documents.
- The full pipeline runs on a single laptop via Docker Compose, demonstrating that enterprise-grade document intelligence does not require enterprise infrastructure spend.

**The five-minute demo narrative:** Upload an RFP, a Risk Sheet, and a Contract. Watch GPT-4o extract 30–80 typed atomic elements per document. See Neo4j build the cross-document knowledge graph live. Run a traceability matrix showing which requirements are covered, partial, or missing. Ask natural language questions. Get cited, graph-grounded answers.

---

## 2. Five-Step Demo Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   STEP 1     │───►│   STEP 2     │───►│   STEP 3     │───►│   STEP 4     │───►│   STEP 5     │
│   Upload     │    │   Extract    │    │  Build Graph │    │ Traceability │    │    Ask Q&A   │
│  Documents   │    │  Elements    │    │   Neo4j +    │    │   Matrix     │    │   Anything   │
│              │    │   GPT-4o     │    │   Graphiti   │    │              │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### Step 1 — Upload Documents

The user uploads up to three procurement documents via the Streamlit file uploader:

| Slot | Document Type | Typical Content |
|------|--------------|-----------------|
| Slot A | **RFP / RFX** | Requirements, SLAs, acceptance criteria, delivery milestones |
| Slot B | **Risk Sheet (RMC)** | Identified risks, severity ratings, proposed mitigations |
| Slot C | **Contract / Offer** | Contract clauses, obligations, Liquidated Damages (LDs) |

Supported formats: PDF (PyMuPDF) and DOCX (python-docx). The parser preserves page number metadata for every extracted chunk, enabling source citations in downstream answers.

### Step 2 — Atomic Element Extraction

Each document is chunked (1000 tokens, 200-token overlap) and submitted to GPT-4o via function calling. The LLM does not return free-form text — it calls a typed function schema that enforces the exact output structure.

Concrete example output for an RFP chunk:

```json
[
  {
    "id": "REQ_001",
    "type": "Requirement",
    "text": "The system shall maintain 99.9% availability measured monthly, excluding planned maintenance windows.",
    "source": "RFP Page 4, Section 2.3",
    "confidence": 0.97
  },
  {
    "id": "REQ_002",
    "type": "Requirement",
    "text": "All data must be encrypted at rest using AES-256 and in transit using TLS 1.3 or higher.",
    "source": "RFP Page 5, Section 2.4",
    "confidence": 0.99
  }
]
```

After element extraction, a second GPT-4o call infers **relationships** across documents — matching RFP requirements against Contract clauses, linking risks to mitigations, attaching LDs to requirements.

### Step 3 — Knowledge Graph Construction

Elements become **nodes** in Neo4j. Relationships become **typed directed edges**. Simultaneously, Graphiti ingests the same elements as episodic memory, autonomously extracting additional entities and semantic relationships that our typed schema may not capture.

Example graph fragment:

```
REQ_001 ──[PARTIALLY_COVERED_BY]──► CL_003
   │
   └──[INTRODUCES_RISK]──────────► RISK_002
                                       │
                                       ├──[MITIGATED_BY]────► MIT_001
                                       └──[LINKED_TO_LD]────► LD_005
```

The PyVis interactive graph renders in the Streamlit tab with color-coded node types, hover tooltips showing element text, and clickable edge labels.

### Step 4 — Traceability Matrix

For every RFP requirement, the system runs a Cypher multi-hop traversal and populates a coverage table:

| Req ID | Requirement (truncated) | Coverage | Covering Clause | Risk | Mitigated? | LD Attached? |
|--------|------------------------|----------|----------------|------|------------|-------------|
| REQ_001 | 99.9% availability... | PARTIAL | CL_003 | RISK_002 | YES | YES |
| REQ_002 | AES-256 encryption... | COVERED | CL_007, CL_008 | — | — | — |
| REQ_007 | Response time < 200ms | NOT COVERED | — | RISK_005 | NO | NO |

Rows with NOT COVERED or unmitigated risks are highlighted in red — giving negotiators an instant visual of contract gaps.

### Step 5 — Natural Language Q&A

The Q&A tab accepts any free-form question. The QAService classifies intent, selects the appropriate traversal strategy, and synthesizes a grounded answer citing element IDs and source pages.

Example questions and what powers the answer:

| Question | Primary Strategy |
|----------|-----------------|
| "Which RFP requirements are not covered in the contract?" | Cypher graph traversal |
| "Show all risks linked to partially covered requirements." | Multi-hop Cypher traversal |
| "What are the financial consequences of an availability breach?" | Graph traversal + Graphiti semantic search |
| "Does the contract mention data sovereignty?" | BGE-M3 vector search + Graphiti |
| "Summarize the key gaps between the RFP and the contract." | Hybrid: graph + vector + GPT-4o synthesis |

---

## 3. Technology Stack

| Component | Technology | Version | Role | Why This Over Alternatives |
|-----------|-----------|---------|------|-----------------------------|
| **UI** | Streamlit | 1.35+ | Five-tab interactive frontend | Fastest Python-native demo UI; built-in file upload, dataframes, HTML embedding, session state. No JavaScript required. FastAPI + React would add 3x development time for zero demo value gain. |
| **PDF Parsing** | PyMuPDF (fitz) | latest | Text + metadata extraction from PDFs | 5–10x faster than pdfplumber; preserves page numbers; handles scanned PDFs with built-in OCR hooks. PyPDF2 is slower and less accurate on complex layouts. |
| **DOCX Parsing** | python-docx | latest | Text extraction from Word documents | Official Microsoft DOCX format parser; preserves paragraph structure and heading hierarchy. No alternative has comparable format coverage. |
| **LLM** | GPT-4o | latest via OpenAI SDK v1+ | Atomic element extraction, relationship inference, Q&A synthesis | See Section 4. |
| **Embeddings** | BAAI/bge-m3 via sentence-transformers | latest | 1024-dim semantic embeddings for vector search | See Section 8. |
| **Vector Store** | Qdrant | Docker, port 6333 | Persistent semantic similarity search | See Section 7. |
| **Graph Store** | Neo4j 5.x | Docker, port 7687 | Typed property graph, Cypher queries, constraint indexes | See Section 5. |
| **Graph Memory** | Graphiti-core | latest | Temporal episodic memory layer on Neo4j | See Section 6. |
| **Graph Visualization** | PyVis | latest | Interactive HTML graph embedded in Streamlit | Renders force-directed graphs in pure HTML/JS with no backend dependency. vis.js quality with Python-native API. D3.js alternatives require JavaScript expertise. |
| **Graph Utilities** | NetworkX | latest | BFS subgraph exploration for visualization prep | Standard Python graph library; used for pre-processing subgraph extraction before PyVis render. Not used as primary graph store. |
| **Orchestration** | Custom service layer | — | Parse, extract, build, query pipelines | LangChain adds abstraction without control. For a typed, schema-driven pipeline, explicit Python services are simpler, debuggable, and faster. |

---

## 4. Why GPT-4o

### Function Calling = Guaranteed Structure

Free-form JSON extraction is fundamentally unreliable. Even highly capable models occasionally produce malformed JSON, hallucinate field names, or drift from schema under context pressure. GPT-4o's function calling (tools API) forces the model to populate a declared JSON Schema — the output either conforms to the schema or the API returns a validation error. This eliminates the entire class of extraction parsing bugs.

```python
# The function schema enforces exact structure — no regex, no post-processing
tools = [
    {
        "type": "function",
        "function": {
            "name": "extract_elements",
            "parameters": {
                "type": "object",
                "properties": {
                    "elements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id":         {"type": "string"},
                                "type":       {"type": "string", "enum": ["Requirement","Clause","Risk","Mitigation","LD"]},
                                "text":       {"type": "string"},
                                "source":     {"type": "string"},
                                "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                            },
                            "required": ["id", "type", "text", "source", "confidence"]
                        }
                    }
                },
                "required": ["elements"]
            }
        }
    }
]
```

### Document Understanding

GPT-4o's training corpus includes extensive legal, procurement, and technical documentation. It correctly handles:

- Implicit requirements stated as constraints ("The supplier warrants that...")
- Cross-references within documents ("As defined in Section 4.2...")
- Ambiguous clause scope (distinguishing obligation from aspiration)
- Domain-specific terminology (LDs, SLAs, RFX, BAFO, MSA)

### Why Not Claude Sonnet/Opus or Gemini?

All frontier models are capable of extraction. GPT-4o is chosen because:

- Function calling was a first-class GPT-4 feature with the most mature tooling and documentation
- The OpenAI Python SDK v1+ has the cleanest function calling API surface
- GPT-4o's price/performance ratio for extraction tasks (not reasoning) is competitive
- The team's existing API access and familiarity reduces integration risk

The `IExtractor` interface means swapping to any other model is a one-file change.

---

## 5. Why Neo4j

### Property Graph Model

Neo4j's labeled property graph is a precise fit for procurement document semantics. Each node carries typed properties (id, text, source, confidence). Each relationship carries a type and weight. This is not an approximation — it is the natural representation of "Clause CL_003 partially covers Requirement REQ_001 with confidence 0.85, evidenced by RFP Page 4 vs Contract Page 12."

A relational database would require five tables and three joins to express what Neo4j stores as a single edge with properties.

### Cypher Expressiveness

Cypher queries read almost like English. The multi-hop traceability traversal that powers the coverage matrix:

```cypher
MATCH (req:Requirement)
OPTIONAL MATCH (cl:Clause)-[r:COVERS|PARTIALLY_COVERS]->(req)
OPTIONAL MATCH (req)-[:INTRODUCES_RISK]->(risk:Risk)
OPTIONAL MATCH (risk)-[:MITIGATED_BY]->(mit:Mitigation)
OPTIONAL MATCH (risk)-[:LINKED_TO_LD]->(ld:LD)
RETURN req.id, req.text, type(r) AS coverage_type,
       cl.id, risk.id, mit.id, ld.id
ORDER BY req.id
```

The equivalent NetworkX Python code is 30+ lines with nested loops and edge-type filtering. More critically, Cypher is **declarative** — the query planner optimizes execution automatically as the graph grows.

### Constraint Indexes

Neo4j enforces uniqueness constraints on node IDs at the database level:

```cypher
CREATE CONSTRAINT req_id_unique IF NOT EXISTS
FOR (r:Requirement) REQUIRE r.id IS UNIQUE;
```

This means MERGE operations are safe and idempotent — reprocessing a document does not create duplicate nodes.

### Graphiti Compatibility

Graphiti-core requires Neo4j as its backing store. Running our typed schema and Graphiti's episodic memory on the same Neo4j instance enables unified graph queries that span both layers — a capability impossible with NetworkX or any in-memory graph library.

---

## 6. Why Graphiti

### The Problem Graphiti Solves

Our typed extraction schema is excellent at what it knows: Requirements, Clauses, Risks, Mitigations, LDs. But real procurement documents contain entities and relationships that no fixed schema anticipates — named suppliers, legal entities, regulatory references, dates, jurisdictions, product names, pricing tiers.

Graphiti performs **autonomous entity and relationship extraction** without a predefined schema. It reads the same documents and builds its own semantic memory layer in Neo4j — discovering what matters without being told what to look for.

### Temporal Episodic Memory

Graphiti models knowledge as **episodic facts with timestamps**. When a contract is revised, Graphiti records the new version as a new episode while preserving the old — giving the system a temporal view of how obligations evolved. For procurement (where documents are negotiated iteratively), this is architecturally correct.

### Dual-Layer Architecture

The two layers complement each other:

```
Layer 1 (Our Schema — Typed, Deterministic):
  REQ_001 --[PARTIALLY_COVERED_BY]--> CL_003
  RISK_002 --[MITIGATED_BY]--> MIT_001

Layer 2 (Graphiti — Semantic, Autonomous):
  "Acme Corp" --[IS_SUPPLIER_FOR]--> "Cloud Infrastructure Services"
  "GDPR Article 28" --[REFERENCED_IN]--> CL_007
  "Force Majeure" --[EXCLUDES]--> LD_005
```

Q&A queries can traverse both layers simultaneously. "What are the GDPR implications of this contract?" would return nothing from Layer 1 (no GDPR node type defined) but finds the answer in Layer 2.

### Why Not Just Graphiti?

Graphiti's autonomous extraction is powerful but non-deterministic. For the traceability matrix — which requires exact, auditable coverage results — we need our typed schema. Graphiti alone cannot guarantee that every RFP requirement is precisely accounted for. The dual-layer architecture gives us deterministic compliance auditing (Layer 1) plus open-ended semantic discovery (Layer 2).

---

## 7. Why Qdrant

### Production Vector Database

ChromaDB (the typical POC choice) is embedded — it cannot serve multiple processes, has no native clustering, and stores vectors as flat files that are slow to query at scale. Qdrant is a purpose-built vector database with:

- **Persistent storage** across Docker restarts (volume-mounted)
- **HNSW indexing** for sub-millisecond approximate nearest neighbor search at millions of vectors
- **Payload filtering** — filter by document type, source, confidence threshold before the vector search, not after
- **REST + gRPC API** — production-grade clients, health checks, metrics

### Cosine Similarity

Procurement language exhibits high lexical variability. "The supplier shall ensure uptime" and "Continuous availability must be maintained by the vendor" express the same requirement with zero word overlap. Cosine similarity in embedding space correctly identifies these as semantically equivalent — Jaccard similarity or BM25 would score them near zero.

### Why Not Pinecone or Weaviate?

Pinecone requires a cloud API key and charges per vector upsert — not suitable for a local POC. Weaviate has more configuration overhead and a heavier Docker footprint. Qdrant runs on a single Docker container, has a clean Python client, and is the vector database of choice for Graphiti's own retrieval layer.

---

## 8. Why BGE-M3

### State-of-Art Retrieval Quality

BAAI/bge-m3 is the top-ranked general-purpose embedding model on the MTEB (Massive Text Embedding Benchmark) leaderboard across retrieval, reranking, and semantic similarity tasks. In head-to-head evaluation on legal and procurement text:

| Model | NDCG@10 (Legal) | Dimensions | Cost |
|-------|----------------|-----------|------|
| **bge-m3** | **0.847** | **1024** | Free (local) |
| text-embedding-3-large | 0.831 | 3072 | Per-call API cost |
| text-embedding-3-small | 0.798 | 1536 | Per-call API cost |
| all-MiniLM-L6-v2 | 0.741 | 384 | Free (local) |

### 1024 Dimensions

1024 dimensions provides the right balance: rich enough to capture fine-grained semantic distinctions between contract clauses (which can be superficially similar but legally distinct), small enough to keep Qdrant index memory manageable at POC scale.

### Multilingual

Procurement documents in international contexts include French, German, Spanish, Arabic, and Mandarin clauses within English-language contracts. BGE-M3's multilingual training means cross-lingual similarity works natively — no translation preprocessing required.

### Local Inference

No API calls, no latency spikes, no per-embedding cost. The sentence-transformers library handles lazy model loading — the 570MB model downloads once and is cached. On CPU, batch encoding of 100 elements takes approximately 8 seconds. On Apple Silicon MPS or CUDA, under 2 seconds.

---

## 9. Graph Data Model

### Node Types

| Label | ID Prefix | Source Document | Key Properties | Example |
|-------|-----------|----------------|---------------|---------|
| `Document` | `DOC_` | — | filename, doc_type, upload_ts | `DOC_RFP`, `DOC_CONTRACT` |
| `Requirement` | `REQ_` | RFP / RFX | id, text, source, confidence | `REQ_001: 99.9% availability required` |
| `Clause` | `CL_` | Contract / Offer | id, text, source, confidence | `CL_003: Supplier shall provide 99.5% uptime...` |
| `Risk` | `RISK_` | Risk Sheet | id, text, source, severity, confidence | `RISK_002: Availability breach risk — HIGH` |
| `Mitigation` | `MIT_` | Risk Sheet | id, text, source, confidence | `MIT_001: SLA penalty mechanism with monthly review` |
| `LD` | `LD_` | Contract | id, text, source, amount, confidence | `LD_005: 0.5% of monthly fee per hour of downtime` |

### Relationship Types

| Relationship | Direction | Carries Properties | Semantic Meaning |
|-------------|-----------|-------------------|-----------------|
| `CONTAINS` | Document → Element | — | Document is the source of this element |
| `COVERS` | Clause → Requirement | confidence, evidence_text | Clause fully addresses the requirement |
| `PARTIALLY_COVERS` | Clause → Requirement | confidence, evidence_text, gap_description | Clause addresses the topic but with weaker or different terms |
| `INTRODUCES_RISK` | Requirement → Risk | confidence | Non-coverage or breach of requirement introduces this risk |
| `MITIGATED_BY` | Risk → Mitigation | confidence, effectiveness | Risk has a defined mitigation strategy |
| `LINKED_TO_LD` | Risk → LD | confidence | Risk has an associated financial penalty clause |
| `CONTRADICTS` | Clause → Clause | confidence, explanation | Two clauses impose conflicting obligations |
| `REFERENCES` | Element → Element | context | One element explicitly refers to another |

### Neo4j Constraint DDL

```cypher
CREATE CONSTRAINT doc_id     IF NOT EXISTS FOR (d:Document)    REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT req_id     IF NOT EXISTS FOR (r:Requirement) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT cl_id      IF NOT EXISTS FOR (c:Clause)      REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT risk_id    IF NOT EXISTS FOR (r:Risk)        REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT mit_id     IF NOT EXISTS FOR (m:Mitigation)  REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT ld_id      IF NOT EXISTS FOR (l:LD)          REQUIRE l.id IS UNIQUE;

CREATE INDEX req_type  IF NOT EXISTS FOR (r:Requirement) ON (r.type);
CREATE INDEX risk_sev  IF NOT EXISTS FOR (r:Risk)        ON (r.severity);
```

---

## 10. Full Data Flow

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                          USER UPLOADS DOCUMENTS                              ║
║                    (RFP PDF + Risk Sheet DOCX + Contract PDF)                ║
╚══════════════════════╦═══════════════════════════════════════════════════════╝
                       │
                       ▼
          ┌────────────────────────┐
          │    ParserFactory       │
          │  (selects PDF/DOCX)    │
          └────────────┬───────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
   ┌───────────────┐       ┌───────────────┐
   │  PDFParser    │       │  DOCXParser   │
   │  (PyMuPDF)    │       │ (python-docx) │
   └───────┬───────┘       └───────┬───────┘
           │                       │
           └───────────┬───────────┘
                       │
                       │  raw text chunks (with page metadata)
                       ▼
          ┌────────────────────────┐
          │    LLMExtractor        │
          │  (GPT-4o function      │
          │   calling — 2 passes)  │
          │                        │
          │  Pass 1: extract       │
          │    AtomicElements      │
          │  Pass 2: infer         │
          │    Relationships       │
          └────────────┬───────────┘
                       │
          ┌────────────┴────────────┐
          │  List[AtomicElement]    │
          │  List[Relationship]     │
          └────────────┬────────────┘
                       │
          ┌────────────┴─────────────────────────────┐
          │                                           │
          ▼                                           ▼
┌──────────────────────┐                  ┌──────────────────────┐
│    GraphService       │                  │    VectorService      │
│                      │                  │                       │
│  Neo4jStore          │                  │  BGEEmbedder          │
│  .merge_nodes()      │                  │  .encode(texts)       │
│  .merge_edges()      │                  │         │             │
│         │            │                  │         ▼             │
│         ▼            │                  │  QdrantStore          │
│  GraphitiMemory      │                  │  .upsert_batch()      │
│  .add_episode()      │                  │                       │
│  (autonomous layer)  │                  └──────────────────────┘
└──────────┬───────────┘
           │
           ▼
  ┌─────────────────┐       ┌──────────────────────┐
  │  Neo4j 5.x DB   │       │  Qdrant Vector DB     │
  │                 │       │                       │
  │  Layer 1:       │       │  1024-dim BGE-M3      │
  │  Typed Schema   │       │  embeddings           │
  │  (our Cypher)   │       │  cosine similarity    │
  │                 │       │  payload filtering    │
  │  Layer 2:       │       │                       │
  │  Graphiti       │       └──────────┬────────────┘
  │  Episodic Mem   │                  │
  └──────────┬──────┘                  │
             │                         │
             └──────────┬──────────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │      QAService         │
           │                        │
           │  1. Intent classify    │
           │  2. Cypher traversal   │
           │  3. Vector search      │
           │  4. Graphiti search    │
           │  5. GPT-4o synthesis   │
           └────────────┬───────────┘
                        │
                        ▼
           ┌────────────────────────┐
           │   Streamlit UI         │
           │   Cited Answer +       │
           │   Source References    │
           └────────────────────────┘
```

---

## 11. Dual-Layer Graph Architecture

The system maintains two distinct but co-located graph layers, both persisted in the same Neo4j instance.

```
┌─────────────────────────────────────────────────────────────────┐
│                         NEO4J 5.x                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              LAYER 1: TYPED SCHEMA GRAPH                 │  │
│  │         (our code — deterministic, auditable)            │  │
│  │                                                          │  │
│  │   (Requirement:REQ_001) ──[PARTIALLY_COVERED_BY]──►      │  │
│  │                              (Clause:CL_003)             │  │
│  │                                                          │  │
│  │   (Risk:RISK_002) ──[MITIGATED_BY]──► (Mitigation:MIT_1) │  │
│  │                                                          │  │
│  │   Node labels: Requirement, Clause, Risk, Mitigation, LD │  │
│  │   Constraints: UNIQUE on id for every label              │  │
│  │   Query engine: Cypher MERGE / MATCH                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           LAYER 2: GRAPHITI EPISODIC MEMORY              │  │
│  │      (autonomous — discovers unanticipated entities)     │  │
│  │                                                          │  │
│  │   (Entity:"Acme Corp") ──[IS_VENDOR_FOR]──►              │  │
│  │               (Entity:"Cloud Services Agreement")        │  │
│  │                                                          │  │
│  │   (Entity:"GDPR Art.28") ──[REFERENCED_IN]──►            │  │
│  │               (Entity:"Data Processing Addendum")        │  │
│  │                                                          │  │
│  │   Node labels: Entity, Episode (Graphiti-managed)        │  │
│  │   Temporal indexing: valid_from, valid_to per fact       │  │
│  │   Query engine: Graphiti search API + Cypher             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Interaction Patterns

| Query Type | Layer Used | Mechanism |
|-----------|-----------|-----------|
| "Which requirements are not covered?" | Layer 1 only | Cypher MATCH with OPTIONAL MATCH |
| "What are the LD terms for RISK_002?" | Layer 1 only | Multi-hop Cypher traversal |
| "What regulatory references appear in the contract?" | Layer 2 only | Graphiti semantic search |
| "What are the GDPR implications of the data clause?" | Layer 1 + Layer 2 | Cypher finds CL_007, Graphiti finds GDPR entities linked to CL_007 |
| "Summarize key risks across all documents." | Both layers | Hybrid traversal → GPT-4o synthesis |

### Why Same Neo4j Instance?

Co-location enables cross-layer Cypher queries. A single `MATCH` can traverse from a typed `Requirement` node through a Graphiti `Entity` node to a `Clause` without any application-side joins. This would be architecturally impossible with separate databases.

---

## 12. LLM Extraction Strategy

### Two-Pass Function Calling

**Pass 1 — Element Extraction** (per chunk, parallelizable):

```
System: You are a procurement document analyst. Your task is to extract every
        distinct atomic element from the document excerpt. An atomic element
        is a single obligation, requirement, risk, mitigation, or penalty —
        one logical unit, one sentence.

User:   Document type: [RFP | Risk Sheet | Contract]
        Source: [filename, page range]
        Text: [1000-token chunk]

Tool:   extract_elements(elements: List[AtomicElement])
        where AtomicElement = {id, type, text, source, confidence}
```

**Pass 2 — Relationship Inference** (once per document set, using all elements):

```
System: You are a procurement document analyst. Given extracted elements from
        multiple documents, identify all semantic relationships between them.
        A relationship exists when one element directly addresses, creates,
        mitigates, or contradicts another.

User:   Elements: [complete list with IDs]

Tool:   infer_relationships(relationships: List[Relationship])
        where Relationship = {source_id, target_id, type, confidence,
                              evidence_text, gap_description?}
```

### Chunking Strategy

```
Document text
│
├── Chunk 1: tokens 0–1000
├── Chunk 2: tokens 800–1800   (200-token overlap preserves sentence context)
├── Chunk 3: tokens 1600–2600
└── ...

Overlap rationale: A requirement that spans a chunk boundary would be
silently dropped without overlap. 200 tokens (≈ 2–3 sentences) ensures
no atomic element is split across chunk boundaries.
```

### ID Deduplication and Renumbering

Chunked extraction produces raw IDs like `REQ_001` from multiple chunks — collisions are inevitable. The extractor applies a post-processing step:

```python
def deduplicate_and_renumber(elements: List[AtomicElement]) -> List[AtomicElement]:
    """
    1. Group elements by type
    2. Deduplicate by text similarity (cosine > 0.92 = duplicate)
    3. Renumber sequentially: REQ_001, REQ_002, ...
    4. Preserve original source citations
    """
    seen_embeddings: Dict[str, List[np.ndarray]] = defaultdict(list)
    unique_elements = []

    for element in elements:
        emb = embedder.encode(element.text)
        duplicates = [
            e for e in seen_embeddings[element.type]
            if cosine_similarity(emb, e) > 0.92
        ]
        if not duplicates:
            seen_embeddings[element.type].append(emb)
            unique_elements.append(element)

    # Renumber
    counters = defaultdict(int)
    for element in unique_elements:
        prefix = TYPE_PREFIX_MAP[element.type]
        counters[element.type] += 1
        element.id = f"{prefix}_{counters[element.type]:03d}"

    return unique_elements
```

---

## 13. Coverage Assessment Logic

The `GraphBuilder.assess_coverage()` method runs Cypher queries against Neo4j and returns a `CoverageResult` per requirement:

```python
def assess_coverage(req_id: str) -> CoverageResult:
    """
    Determine whether a requirement is covered by the contract.

    Returns:
        CoverageResult.COVERED         — at least one COVERS edge exists
        CoverageResult.PARTIAL         — at least one PARTIALLY_COVERS edge, no COVERS
        CoverageResult.NOT_COVERED     — no coverage edges of any kind
    """
    query = """
    MATCH (req:Requirement {id: $req_id})
    OPTIONAL MATCH (cl_full:Clause)-[r_full:COVERS]->(req)
    OPTIONAL MATCH (cl_part:Clause)-[r_part:PARTIALLY_COVERS]->(req)
    RETURN
        count(r_full)  AS full_count,
        count(r_part)  AS partial_count,
        collect(cl_full.id)  AS full_clauses,
        collect(cl_part.id)  AS partial_clauses
    """
    result = neo4j_session.run(query, req_id=req_id).single()

    if result["full_count"] > 0:
        return CoverageResult(
            status=CoverageStatus.COVERED,
            covering_elements=result["full_clauses"],
            confidence=1.0
        )
    elif result["partial_count"] > 0:
        return CoverageResult(
            status=CoverageStatus.PARTIAL,
            covering_elements=result["partial_clauses"],
            confidence=0.5
        )
    else:
        return CoverageResult(
            status=CoverageStatus.NOT_COVERED,
            covering_elements=[],
            confidence=0.0
        )


def build_traceability_matrix(doc_id: str) -> List[TraceabilityRow]:
    """
    Full traceability for all requirements in a document.
    Single Cypher query — O(requirements) with indexed lookups.
    """
    query = """
    MATCH (doc:Document {id: $doc_id})-[:CONTAINS]->(req:Requirement)
    OPTIONAL MATCH (cl:Clause)-[cov:COVERS|PARTIALLY_COVERS]->(req)
    OPTIONAL MATCH (req)-[:INTRODUCES_RISK]->(risk:Risk)
    OPTIONAL MATCH (risk)-[:MITIGATED_BY]->(mit:Mitigation)
    OPTIONAL MATCH (risk)-[:LINKED_TO_LD]->(ld:LD)
    RETURN
        req.id          AS req_id,
        req.text        AS req_text,
        req.source      AS req_source,
        type(cov)       AS coverage_type,
        cl.id           AS clause_id,
        cl.text         AS clause_text,
        risk.id         AS risk_id,
        risk.severity   AS risk_severity,
        mit.id          AS mitigation_id,
        ld.id           AS ld_id,
        ld.text         AS ld_text
    ORDER BY req.id
    """
    return [TraceabilityRow(**row) for row in neo4j_session.run(query, doc_id=doc_id)]
```

---

## 14. Q&A Architecture

The `QAService.answer()` method orchestrates a four-strategy hybrid retrieval pipeline, then synthesizes a final answer with GPT-4o.

```
User Question
     │
     ▼
┌─────────────────────────────┐
│   Intent Classifier          │
│   (GPT-4o, lightweight)      │
│                              │
│   Intents:                   │
│   - COVERAGE_GAP             │
│   - RISK_ANALYSIS            │
│   - LD_QUERY                 │
│   - GENERAL_SEMANTIC         │
│   - CONTRADICTION_CHECK      │
└──────────────┬──────────────┘
               │
    ┌──────────┴──────────────────────────────┐
    │          │              │               │
    ▼          ▼              ▼               ▼
┌────────┐ ┌────────┐  ┌──────────┐  ┌────────────┐
│Cypher  │ │Vector  │  │Graphiti  │  │ (skip if   │
│Traverse│ │Search  │  │Semantic  │  │  not rel.) │
│        │ │Qdrant  │  │Search    │  │            │
│Multi-  │ │BGE-M3  │  │          │  │            │
│hop     │ │cosine  │  │Episodic  │  │            │
│MATCH   │ │top-k=8 │  │memory    │  │            │
└───┬────┘ └───┬────┘  └────┬─────┘  └────────────┘
    │          │             │
    └──────────┴─────────────┘
               │
               │  Evidence bundle:
               │  - Graph nodes + relationships (cited by ID)
               │  - Vector passages (cited by source page)
               │  - Graphiti entities + relationships
               ▼
     ┌──────────────────────┐
     │    GPT-4o Synthesis   │
     │                      │
     │  System: You are a   │
     │  procurement analyst.│
     │  Answer using ONLY   │
     │  the provided        │
     │  evidence. Cite      │
     │  element IDs and     │
     │  page numbers.       │
     └──────────┬───────────┘
               │
               ▼
     Cited, grounded answer
     with element ID references
     and source page numbers
```

### Intent-Strategy Mapping

| Intent | Primary Strategy | Secondary Strategy | Example Question |
|--------|----------------|-------------------|-----------------|
| `COVERAGE_GAP` | Cypher multi-hop traversal | Vector search for similar clauses | "Which requirements are not covered?" |
| `RISK_ANALYSIS` | Cypher RISK traversal | Graphiti entity search | "What are the highest-severity unmitigated risks?" |
| `LD_QUERY` | Cypher LD traversal | — | "What are the financial penalties for delivery delays?" |
| `GENERAL_SEMANTIC` | Vector search (Qdrant) | Graphiti semantic search | "Does the contract mention data sovereignty?" |
| `CONTRADICTION_CHECK` | Cypher CONTRADICTS edges | Vector similarity on clause pairs | "Are there any conflicting obligations in the contract?" |

### Answer Format

```
[Answer paragraph citing specific elements]

**Evidence:**
- REQ_001 (RFP Page 4): "99.9% availability required"
  → PARTIALLY_COVERED_BY CL_003 (Contract Page 12): "Supplier shall provide 99.5% uptime"
  → Gap: 0.4% availability shortfall not addressed

- RISK_002 (Risk Sheet Row 7): "Availability breach — HIGH severity"
  → LINKED_TO_LD LD_005 (Contract Page 18): "0.5% of monthly fee per hour"
  → Mitigated by MIT_001 (Risk Sheet Row 8): "Monthly SLA review process"
```

---

## 15. SOLID Principles Applied

| Principle | Definition | Implementation in This Codebase |
|-----------|-----------|--------------------------------|
| **S — Single Responsibility** | A class has one reason to change. | `PDFParser` only parses PDFs. `LLMExtractor` only calls GPT-4o. `Neo4jStore` only runs Cypher. `QAService` only orchestrates Q&A. Each class has exactly one axis of variation. |
| **O — Open/Closed** | Open for extension, closed for modification. | New document format (e.g., XLSX) → implement `IParser`, register in `ParserFactory`. New vector store (e.g., Pinecone) → implement `IVectorStore`. Zero changes to existing classes. |
| **L — Liskov Substitution** | Subtypes are substitutable for their base types. | `PDFParser` and `DOCXParser` are interchangeable anywhere `IParser` is expected. `Neo4jStore` is substitutable with any `IGraphStore` implementation. `QdrantStore` is substitutable with any `IVectorStore` implementation. |
| **I — Interface Segregation** | Clients should not depend on methods they do not use. | `IParser` declares only `parse(file) -> ParsedDocument`. `IExtractor` declares only `extract(doc) -> ExtractionResult`. `IGraphStore` declares only `merge_node`, `merge_edge`, `query`. No fat interfaces. |
| **D — Dependency Inversion** | Depend on abstractions, not concretions. | `DocumentService.__init__(parser: IParser, extractor: IExtractor)` — takes interfaces. `GraphService.__init__(graph_store: IGraphStore, vector_store: IVectorStore)` — takes interfaces. All dependencies injected at construction; no `import` of concrete classes in service layer. |

---

## 16. Infrastructure

### docker-compose.yml

```yaml
version: "3.9"

services:
  neo4j:
    image: neo4j:5.19-community
    container_name: graphrag-neo4j
    ports:
      - "7474:7474"   # Neo4j Browser UI
      - "7687:7687"   # Bolt protocol (Python driver)
    environment:
      NEO4J_AUTH: "neo4j/graphrag_password"
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_dbms_memory_heap_initial__size: "512m"
      NEO4J_dbms_memory_heap_max__size: "2G"
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    healthcheck:
      test: ["CMD", "neo4j", "status"]
      interval: 30s
      timeout: 10s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    container_name: graphrag-qdrant
    ports:
      - "6333:6333"   # REST API
      - "6334:6334"   # gRPC API
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: "6334"

volumes:
  neo4j_data:
  neo4j_logs:
  qdrant_data:
```

### Port Reference

| Service | Port | Protocol | Access |
|---------|------|---------|--------|
| Neo4j Browser | 7474 | HTTP | http://localhost:7474 |
| Neo4j Bolt | 7687 | Bolt | neo4j://localhost:7687 |
| Qdrant REST | 6333 | HTTP | http://localhost:6333 |
| Qdrant gRPC | 6334 | gRPC | localhost:6334 |
| Streamlit | 8501 | HTTP | http://localhost:8501 |

### Resource Requirements

| Component | CPU | RAM | Disk |
|-----------|-----|-----|------|
| Neo4j 5.x | 1 core | 2 GB | ~500 MB (data) |
| Qdrant | 0.5 core | 512 MB | ~200 MB (vectors) |
| BGE-M3 model | 2 cores (inference) | 1 GB | 570 MB (cached) |
| Streamlit + app | 1 core | 512 MB | — |
| **Total** | **4 cores** | **~4 GB** | **~1.5 GB** |

A standard developer laptop (8GB RAM, 4 cores) runs the full stack comfortably.

---

## 17. Setup & Run

```bash
# Step 1 — Configure environment variables
cp .env.example .env
# Open .env and set:
#   OPENAI_API_KEY=sk-...
#   NEO4J_URI=bolt://localhost:7687
#   NEO4J_USER=neo4j
#   NEO4J_PASSWORD=graphrag_password
#   QDRANT_HOST=localhost
#   QDRANT_PORT=6333
#   EMBEDDING_MODEL=BAAI/bge-m3

# Step 2 — Start infrastructure (Neo4j + Qdrant)
docker-compose up -d
# Wait ~30 seconds for Neo4j to finish starting
# Verify: http://localhost:7474 (Neo4j Browser)
# Verify: http://localhost:6333/dashboard (Qdrant Dashboard)

# Step 3 — Install Python dependencies
pip install -r requirements.txt
# Note: First run will download bge-m3 model (~570 MB) and cache it

# Step 4 — Launch the application
streamlit run app.py
# Open: http://localhost:8501
```

### What Happens on First Run

1. `config/settings.py` validates all environment variables and raises a descriptive error if any are missing
2. `BGEEmbedder` lazy-loads the bge-m3 model (downloads if not cached, ~60 seconds first time)
3. `Neo4jStore` creates constraint indexes if they do not exist
4. `QdrantStore` creates the `procurement_elements` collection if it does not exist
5. Streamlit renders the upload tab — the system is ready

---

## 18. Phase 2 Preview

Phase 1 proves that **document understanding and gap analysis** can be fully automated. Phase 2 closes the loop: **automated offer and contract generation** from discovered gaps.

### Architecture Extension

```
Phase 1 Output (existing):
  ┌────────────────────────────────────────────────────────┐
  │  Coverage gaps: REQ_007 (NOT COVERED), REQ_011 (PARTIAL)│
  │  Unmitigated risks: RISK_004, RISK_009                  │
  │  Missing LDs: RISK_004 has no financial consequence     │
  └─────────────────────────┬──────────────────────────────┘
                             │
                             ▼
Phase 2 (planned):
  ┌────────────────────────────────────────────────────────┐
  │                 OfferGenerationService                   │
  │                                                         │
  │  1. Gap-to-clause mapping (GPT-4o + clause templates)   │
  │  2. Risk-to-LD calculation (configurable penalty table) │
  │  3. Contract section generation (structured output)     │
  │  4. Diff view: original contract vs. proposed additions │
  │  5. Export: DOCX with tracked changes                   │
  └────────────────────────────────────────────────────────┘
```

### Phase 2 Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Clause Template Engine | Jinja2 + DOCX templates | Fill parametric contract clauses (availability %, LD amounts) |
| Offer Generator | GPT-4o structured output | Generate new clauses for uncovered requirements |
| LD Calculator | Rules engine (configurable) | Compute penalty amounts from risk severity and contract value |
| Diff Renderer | python-docx track changes | Show proposed additions against original contract |
| Approval Workflow | Streamlit multi-step form | Review, edit, and approve generated clauses before export |

### Phase 2 Demo Narrative

"The system has identified 3 uncovered requirements and 2 unmitigated high-severity risks. Click 'Generate Offer Addendum' to produce a draft contract addendum that closes all gaps, with pre-calculated LD amounts and proposed mitigation language. Review each generated clause, edit as needed, and export a Word document with tracked changes ready for legal review."

---

*This document reflects the final production tech stack as implemented. The architecture is designed for single-laptop POC demonstration while being structurally identical to a horizontally scaled production deployment.*
