"""
Pipeline route — streams SSE events as documents are processed.

POST /api/pipeline/run   multipart/form-data  files[]=...
streams: text/event-stream  (JSON lines prefixed with "data: ")

Event shape:
    {"type": "step_start",    "step": str, "label": str}
    {"type": "step_progress", "step": str, "message": str, "current": int, "total": int}
    {"type": "step_complete", "step": str, "count": int, "elapsed": float}
    {"type": "pipeline_complete", "summary": {...}}
    {"type": "error",         "step": str, "message": str}
"""
from __future__ import annotations

import json
import time
from typing import AsyncGenerator

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from api.deps import get_doc_service, get_graph_service

router = APIRouter(prefix="/api")


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream_pipeline(
    file_data: list[tuple[bytes, str]],
) -> AsyncGenerator[str, None]:
    import hashlib

    t0 = time.perf_counter()
    doc_svc = get_doc_service()
    graph_svc = get_graph_service()

    skipped: list[str] = []
    to_process: list[tuple[bytes, str]] = []

    # ── Step 1: Parse + Dedup ───────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "parse", "label": "Parsing Documents", "total": len(file_data)})

    try:
        existing_hashes = graph_svc.get_ingested_doc_hashes()
        known_hashes: set[str] = set(existing_hashes.values())

        for fb, fn in file_data:
            h = hashlib.sha256(fb).hexdigest()
            if h in known_hashes:
                skipped.append(fn)
                yield _sse({"type": "step_progress", "step": "parse", "message": f"Skipped '{fn}' — already ingested", "current": len(skipped), "total": len(file_data)})
            else:
                to_process.append((fb, fn))

        if not to_process and skipped:
            yield _sse({"type": "step_complete", "step": "parse", "count": 0, "elapsed": round(time.perf_counter() - t0, 2)})
            for step_id, step_label in [
                ("extract", "Extracting Elements (LLM)"),
                ("graph", "Building Knowledge Graph"),
                ("vector", "Indexing Semantic Vectors"),
            ]:
                yield _sse({"type": "step_start", "step": step_id, "label": step_label, "total": 0})
                yield _sse({"type": "step_complete", "step": step_id, "count": 0, "elapsed": 0})
            yield _sse({"type": "step_start", "step": "coverage", "label": "Assessing Coverage", "total": 0})
            coverage = graph_svc.get_coverage_results()
            yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage), "elapsed": 0})
            yield _sse({
                "type": "pipeline_complete",
                "summary": {
                    "documents": 0,
                    "skipped": len(skipped),
                    "elements": 0,
                    "nodes": graph_svc.get_node_count(),
                    "edges": graph_svc.get_edge_count(),
                    "coverage_items": len(coverage),
                    "elapsed": round(time.perf_counter() - t0, 2),
                },
            })
            return

    except Exception as exc:
        yield _sse({"type": "error", "step": "parse", "message": str(exc)})
        return

    # ── Step 2: LLM Extraction ──────────────────────────────────────────
    yield _sse({"type": "step_complete", "step": "parse", "count": len(to_process), "elapsed": round(time.perf_counter() - t0, 2)})
    yield _sse({"type": "step_start", "step": "extract", "label": "Extracting Elements (LLM)", "total": len(to_process)})

    try:
        t_extract = time.perf_counter()
        docs, elements, new_hashes = doc_svc.process_files(to_process, existing_hashes)
        for i, doc in enumerate(docs):
            yield _sse({
                "type": "step_progress",
                "step": "extract",
                "message": f"Extracted from '{doc.name}' — {len([e for e in elements if e.document_id == doc.id])} elements",
                "current": i + 1,
                "total": len(docs),
            })
    except Exception as exc:
        yield _sse({"type": "error", "step": "extract", "message": str(exc)})
        return

    yield _sse({"type": "step_complete", "step": "extract", "count": len(elements), "elapsed": round(time.perf_counter() - t_extract, 2)})

    if not docs:
        yield _sse({"type": "pipeline_complete", "summary": {"documents": 0, "elements": 0, "nodes": 0, "edges": 0, "elapsed": round(time.perf_counter() - t0, 2)}})
        return

    # ── Step 3: Build Neo4j Graph ───────────────────────────────────────
    yield _sse({"type": "step_start", "step": "graph", "label": "Building Knowledge Graph", "total": len(elements)})
    try:
        t_graph = time.perf_counter()

        # Cross-document relationship extraction (LLM call across ALL elements)
        yield _sse({
            "type": "step_progress", "step": "graph",
            "message": f"Inferring cross-document relationships for {len(elements)} elements (LLM)…",
            "current": 0, "total": len(elements),
        })
        relationships = doc_svc.extract_cross_document_relationships(elements)
        yield _sse({
            "type": "step_progress", "step": "graph",
            "message": f"Found {len(relationships)} relationships — writing graph…",
            "current": len(elements), "total": len(elements),
        })

        graph_svc.builder.build_from_elements(elements, relationships, docs, new_hashes)
        yield _sse({
            "type": "step_complete",
            "step": "graph",
            "count": graph_svc.get_node_count(),
            "elapsed": round(time.perf_counter() - t_graph, 2),
        })
    except Exception as exc:
        yield _sse({"type": "error", "step": "graph", "message": str(exc)})
        return

    # ── Step 4: Vector Index ────────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "vector", "label": "Indexing Semantic Vectors", "total": len(elements)})
    try:
        t_vec = time.perf_counter()
        graph_svc.vector_store.upsert(elements)
        yield _sse({"type": "step_complete", "step": "vector", "count": len(elements), "elapsed": round(time.perf_counter() - t_vec, 2)})
    except Exception as exc:
        yield _sse({"type": "error", "step": "vector", "message": str(exc)})

    # Graphiti ingestion skipped — slow (GPT-4o per page, 120s timeout) and
    # not required for coverage / traceability queries in this POC.

    # ── Step 5: Coverage Assessment ─────────────────────────────────────
    yield _sse({"type": "step_start", "step": "coverage", "label": "Assessing Coverage", "total": 0})
    try:
        t_cov = time.perf_counter()
        coverage = graph_svc.get_coverage_results()
        yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage), "elapsed": round(time.perf_counter() - t_cov, 2)})
    except Exception as exc:
        yield _sse({"type": "error", "step": "coverage", "message": str(exc)})
        coverage = []

    # ── Done ────────────────────────────────────────────────────────────
    yield _sse({
        "type": "pipeline_complete",
        "summary": {
            "documents": len(docs),
            "skipped": len(skipped),
            "elements": len(elements),
            "nodes": graph_svc.get_node_count(),
            "edges": graph_svc.get_edge_count(),
            "coverage_items": len(coverage),
            "elapsed": round(time.perf_counter() - t0, 2),
        },
    })


@router.post("/pipeline/run")
async def run_pipeline(files: list[UploadFile] = File(...)) -> StreamingResponse:
    file_data = [(await f.read(), f.filename or "unknown") for f in files]
    return StreamingResponse(
        _stream_pipeline(file_data),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
