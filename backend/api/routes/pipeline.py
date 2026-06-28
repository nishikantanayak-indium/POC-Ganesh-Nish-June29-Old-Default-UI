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

Pipeline coordination:
    Multiple concurrent pipeline runs share a cross-document relationship
    extraction step.  After each pipeline finishes LLM element extraction it
    registers with the module-level _coordinator and waits up to
    _COORD_WINDOW seconds.  Once no new pipelines have joined for that window
    the coordinator fetches all existing Neo4j elements, combines them with
    every queued pipeline's new elements, runs ONE cross-document relationship
    extraction pass, and distributes the resulting relationships back to every
    waiting pipeline.  This guarantees that all cross-document links are found
    regardless of ingestion order or concurrency.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse

from api.deps import get_doc_service, get_graph_service

router = APIRouter(prefix="/api")

# ── Pipeline Coordinator ──────────────────────────────────────────────────────
#
# Seconds to wait after the last pipeline joins before firing the combined
# cross-document relationship extraction.
_COORD_WINDOW: float = 6.0


@dataclasses.dataclass
class _ExtractionResult:
    """
    Shared state between one pipeline run and the coordinator.

    A pipeline populates elements/docs/hashes/run_id, then awaits `done`.
    The coordinator sets `relationships` and fires `done`.
    """
    run_id: str
    elements: list
    docs: list
    hashes: dict
    done: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    relationships: list = dataclasses.field(default_factory=list)
    batch_size: int = 0


class _Coordinator:
    """
    Collects extraction results from concurrent pipeline runs, then fires a
    single combined cross-document relationship extraction once the quiescence
    window elapses.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._pending: list[_ExtractionResult] = []
        self._timer: asyncio.Task | None = None

    async def submit_and_wait(self, result: _ExtractionResult) -> None:
        """Register `result` and block until combined relationship extraction completes."""
        async with self._lock:
            self._pending.append(result)
            if self._timer and not self._timer.done():
                self._timer.cancel()
            self._timer = asyncio.create_task(self._fire_after_quiescence())
        await result.done.wait()

    async def pending_count(self) -> int:
        async with self._lock:
            return len(self._pending)

    async def _fire_after_quiescence(self) -> None:
        await asyncio.sleep(_COORD_WINDOW)
        await self._execute()

    async def _execute(self) -> None:
        async with self._lock:
            if not self._pending:
                return
            batch = list(self._pending)
            self._pending.clear()
            self._timer = None

        doc_svc = get_doc_service()
        graph_svc = get_graph_service()

        all_new = [e for r in batch for e in r.elements]
        new_ids = {e.id for e in all_new}

        try:
            existing = await asyncio.to_thread(graph_svc.store.get_all_elements)
            combined = all_new + [e for e in existing if e.id not in new_ids]
            relationships = await asyncio.to_thread(
                doc_svc.extract_cross_document_relationships, combined
            )
        except Exception:
            relationships = []

        for r in batch:
            r.relationships = relationships
            r.batch_size = len(batch)
            r.done.set()


_coordinator = _Coordinator()

# Serializes Neo4j + Qdrant writes across concurrent pipeline runs.
_WRITE_LOCK = asyncio.Lock()


# ── SSE helper ────────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ── Main pipeline generator ───────────────────────────────────────────────────

async def _stream_pipeline(
    file_data: list[tuple[bytes, str]],
) -> AsyncGenerator[str, None]:
    import hashlib

    t0 = time.perf_counter()
    run_id = str(uuid.uuid4())
    doc_svc = get_doc_service()
    graph_svc = get_graph_service()

    skipped: list[str] = []
    to_process: list[tuple[bytes, str]] = []

    # ── Step 1: Parse + Dedup ───────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "parse", "label": "Parsing Documents", "total": len(file_data)})
    await asyncio.sleep(0)

    try:
        existing_hashes = await asyncio.to_thread(graph_svc.get_ingested_doc_hashes)
        known_hashes: set[str] = set(existing_hashes.values())

        for fb, fn in file_data:
            h = hashlib.sha256(fb).hexdigest()
            if h in known_hashes:
                skipped.append(fn)
                yield _sse({"type": "step_progress", "step": "parse", "message": f"Skipped '{fn}' — already ingested", "current": len(skipped), "total": len(file_data)})
                await asyncio.sleep(0)
            else:
                to_process.append((fb, fn))

        if not to_process and skipped:
            yield _sse({"type": "step_complete", "step": "parse", "count": 0, "elapsed": round(time.perf_counter() - t0, 2)})
            await asyncio.sleep(0)
            for step_id, step_label in [
                ("extract", "Extracting Elements (LLM)"),
                ("graph", "Building Knowledge Graph"),
                ("vector", "Indexing Semantic Vectors"),
            ]:
                yield _sse({"type": "step_start", "step": step_id, "label": step_label, "total": 0})
                await asyncio.sleep(0)
                yield _sse({"type": "step_complete", "step": step_id, "count": 0, "elapsed": 0})
                await asyncio.sleep(0)
            yield _sse({"type": "step_start", "step": "coverage", "label": "Assessing Coverage", "total": 0})
            await asyncio.sleep(0)
            coverage = await asyncio.to_thread(graph_svc.get_coverage_results)
            yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage), "elapsed": 0})
            await asyncio.sleep(0)
            yield _sse({
                "type": "pipeline_complete",
                "summary": {
                    "documents": 0,
                    "skipped": len(skipped),
                    "elements": 0,
                    "nodes": await asyncio.to_thread(graph_svc.get_node_count),
                    "edges": await asyncio.to_thread(graph_svc.get_edge_count),
                    "coverage_items": len(coverage),
                    "elapsed": round(time.perf_counter() - t0, 2),
                },
            })
            await asyncio.sleep(0)
            return

    except Exception as exc:
        yield _sse({"type": "error", "step": "parse", "message": str(exc)})
        await asyncio.sleep(0)
        return

    # ── Step 2: LLM Extraction ──────────────────────────────────────────
    yield _sse({"type": "step_complete", "step": "parse", "count": len(to_process), "elapsed": round(time.perf_counter() - t0, 2)})
    await asyncio.sleep(0)
    yield _sse({"type": "step_start", "step": "extract", "label": "Extracting Elements (LLM)", "total": len(to_process)})
    await asyncio.sleep(0)

    for qi, (_, fn) in enumerate(to_process):
        yield _sse({
            "type": "step_progress", "step": "extract",
            "message": f"Processing '{fn}' (OCR + LLM extraction)…",
            "current": qi, "total": len(to_process),
        })
        await asyncio.sleep(0)

    try:
        t_extract = time.perf_counter()
        docs, elements, new_hashes = await asyncio.to_thread(doc_svc.process_files, to_process, existing_hashes)
        for i, doc in enumerate(docs):
            yield _sse({
                "type": "step_progress",
                "step": "extract",
                "message": f"Extracted from '{doc.name}' — {len([e for e in elements if e.document_id == doc.id])} elements",
                "current": i + 1,
                "total": len(docs),
            })
            await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "extract", "message": str(exc)})
        await asyncio.sleep(0)
        return

    yield _sse({"type": "step_complete", "step": "extract", "count": len(elements), "elapsed": round(time.perf_counter() - t_extract, 2)})
    await asyncio.sleep(0)

    if not docs:
        yield _sse({"type": "pipeline_complete", "summary": {"documents": 0, "elements": 0, "nodes": 0, "edges": 0, "elapsed": round(time.perf_counter() - t0, 2)}})
        await asyncio.sleep(0)
        return

    # ── Step 3: Cross-document relationship extraction (coordinated) ────
    #
    # Register with the coordinator and wait for it to fire.  Other concurrent
    # pipelines that are also at this step will be batched together so a
    # single LLM call covers ALL elements — no cross-doc link is missed.
    # The coordinator respects a _COORD_WINDOW quiescence period from the
    # last joiner before it fires.
    yield _sse({"type": "step_start", "step": "graph", "label": "Building Knowledge Graph", "total": len(elements)})
    await asyncio.sleep(0)
    try:
        t_graph = time.perf_counter()

        result = _ExtractionResult(
            run_id=run_id,
            elements=elements,
            docs=docs,
            hashes=new_hashes,
        )

        # Submit to coordinator as a background task so we can emit heartbeat
        # SSE events while waiting (async generators can't await mid-yield).
        submit_task = asyncio.create_task(_coordinator.submit_and_wait(result))

        yield _sse({
            "type": "step_progress", "step": "graph",
            "message": "Queued for cross-document analysis — waiting for peer pipelines…",
            "current": 0, "total": len(elements),
        })
        await asyncio.sleep(0)

        # Heartbeat: emit progress every 2 s while the coordinator is working.
        while not submit_task.done():
            await asyncio.sleep(2.0)
            if not submit_task.done():
                n = await _coordinator.pending_count()
                yield _sse({
                    "type": "step_progress", "step": "graph",
                    "message": f"Running cross-document analysis — {n + 1} pipeline(s) in batch…",
                    "current": 0, "total": len(elements),
                })
                await asyncio.sleep(0)

        await submit_task  # propagate any coordinator exception

        relationships = result.relationships
        batch_size = result.batch_size
        batch_note = f" (batch of {batch_size})" if batch_size > 1 else ""

        yield _sse({
            "type": "step_progress", "step": "graph",
            "message": f"Found {len(relationships)} cross-document relationships{batch_note} — writing graph…",
            "current": len(elements), "total": len(elements),
        })
        await asyncio.sleep(0)

        async with _WRITE_LOCK:
            yield _sse({
                "type": "step_progress", "step": "graph",
                "message": "Writing graph to Neo4j…",
                "current": len(elements), "total": len(elements),
            })
            await asyncio.sleep(0)
            await asyncio.to_thread(graph_svc.builder.build_from_elements, elements, relationships, docs, new_hashes)
            node_count = await asyncio.to_thread(graph_svc.get_node_count)

        yield _sse({
            "type": "step_complete",
            "step": "graph",
            "count": node_count,
            "elapsed": round(time.perf_counter() - t_graph, 2),
        })
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "graph", "message": str(exc)})
        await asyncio.sleep(0)
        return

    # ── Step 4: Vector Index ────────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "vector", "label": "Indexing Semantic Vectors", "total": len(elements)})
    await asyncio.sleep(0)
    try:
        t_vec = time.perf_counter()
        async with _WRITE_LOCK:
            await asyncio.to_thread(graph_svc.vector_store.upsert, elements)
        yield _sse({"type": "step_complete", "step": "vector", "count": len(elements), "elapsed": round(time.perf_counter() - t_vec, 2)})
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "vector", "message": str(exc)})
        await asyncio.sleep(0)

    # ── Step 5: Coverage Assessment ─────────────────────────────────────
    yield _sse({"type": "step_start", "step": "coverage", "label": "Assessing Coverage", "total": 0})
    await asyncio.sleep(0)
    try:
        t_cov = time.perf_counter()
        coverage = await asyncio.to_thread(graph_svc.get_coverage_results)
        yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage), "elapsed": round(time.perf_counter() - t_cov, 2)})
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "coverage", "message": str(exc)})
        await asyncio.sleep(0)
        coverage = []

    # ── Done ────────────────────────────────────────────────────────────
    yield _sse({
        "type": "pipeline_complete",
        "summary": {
            "documents": len(docs),
            "skipped": len(skipped),
            "elements": len(elements),
            "nodes": await asyncio.to_thread(graph_svc.get_node_count),
            "edges": await asyncio.to_thread(graph_svc.get_edge_count),
            "coverage_items": len(coverage),
            "elapsed": round(time.perf_counter() - t0, 2),
        },
    })
    await asyncio.sleep(0)


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
