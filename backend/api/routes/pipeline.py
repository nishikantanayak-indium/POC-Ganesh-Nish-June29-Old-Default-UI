"""
Pipeline route — workspace-scoped, SSE streaming.

POST /api/workspaces/{workspace_id}/pipeline/run

Coordination:
    Each workspace gets its own _Coordinator instance.  Concurrent pipeline
    runs within the same workspace share a combined cross-document
    relationship extraction batch.
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

router = APIRouter(prefix="/api/workspaces/{workspace_id}")

_COORD_WINDOW: float = 6.0


@dataclasses.dataclass
class _ExtractionResult:
    run_id: str
    elements: list
    docs: list
    hashes: dict
    done: asyncio.Event = dataclasses.field(default_factory=asyncio.Event)
    relationships: list = dataclasses.field(default_factory=list)
    batch_size: int = 0


class _Coordinator:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._pending: list[_ExtractionResult] = []
        self._timer: asyncio.Task | None = None

    async def submit_and_wait(self, result: _ExtractionResult, workspace_id: str) -> None:
        async with self._lock:
            self._pending.append(result)
            if self._timer and not self._timer.done():
                self._timer.cancel()
            self._timer = asyncio.create_task(
                self._fire_after_quiescence(workspace_id)
            )
        await result.done.wait()

    async def pending_count(self) -> int:
        async with self._lock:
            return len(self._pending)

    async def _fire_after_quiescence(self, workspace_id: str) -> None:
        await asyncio.sleep(_COORD_WINDOW)
        await self._execute(workspace_id)

    async def _execute(self, workspace_id: str) -> None:
        async with self._lock:
            if not self._pending:
                return
            batch = list(self._pending)
            self._pending.clear()
            self._timer = None

        doc_svc = get_doc_service()
        graph_svc = get_graph_service(workspace_id)

        all_new = [e for r in batch for e in r.elements]
        new_ids = {e.id for e in all_new}

        try:
            existing = await asyncio.to_thread(graph_svc.store.get_all_elements, workspace_id)
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


# Per-workspace coordinator instances
_coordinators: dict[str, _Coordinator] = {}
_WRITE_LOCKS: dict[str, asyncio.Lock] = {}


def _get_coordinator(workspace_id: str) -> _Coordinator:
    if workspace_id not in _coordinators:
        _coordinators[workspace_id] = _Coordinator()
    return _coordinators[workspace_id]


def _get_write_lock(workspace_id: str) -> asyncio.Lock:
    if workspace_id not in _WRITE_LOCKS:
        _WRITE_LOCKS[workspace_id] = asyncio.Lock()
    return _WRITE_LOCKS[workspace_id]


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream_pipeline(
    workspace_id: str,
    file_data: list[tuple[bytes, str]],
) -> AsyncGenerator[str, None]:
    import hashlib

    t0 = time.perf_counter()
    run_id = str(uuid.uuid4())
    doc_svc = get_doc_service()
    graph_svc = get_graph_service(workspace_id)
    coordinator = _get_coordinator(workspace_id)
    write_lock = _get_write_lock(workspace_id)

    skipped: list[str] = []
    to_process: list[tuple[bytes, str]] = []

    # ── Step 1: Parse + Dedup ───────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "parse", "label": "Parsing Documents",
                "total": len(file_data)})
    await asyncio.sleep(0)

    try:
        existing_hashes = await asyncio.to_thread(graph_svc.get_ingested_doc_hashes)
        known_hashes: set[str] = set(existing_hashes.values())

        for fb, fn in file_data:
            h = hashlib.sha256(fb).hexdigest()
            if h in known_hashes:
                skipped.append(fn)
                yield _sse({"type": "step_progress", "step": "parse",
                            "message": f"Skipped '{fn}' — already ingested",
                            "current": len(skipped), "total": len(file_data)})
                await asyncio.sleep(0)
            else:
                to_process.append((fb, fn))

        if not to_process and skipped:
            yield _sse({"type": "step_complete", "step": "parse", "count": 0,
                        "elapsed": round(time.perf_counter() - t0, 2)})
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
            yield _sse({"type": "step_start", "step": "coverage",
                        "label": "Assessing Coverage", "total": 0})
            await asyncio.sleep(0)
            coverage = await asyncio.to_thread(graph_svc.get_coverage_results)
            yield _sse({"type": "step_complete", "step": "coverage",
                        "count": len(coverage), "elapsed": 0})
            await asyncio.sleep(0)
            yield _sse({
                "type": "pipeline_complete",
                "summary": {
                    "documents": 0, "skipped": len(skipped), "elements": 0,
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
    yield _sse({"type": "step_complete", "step": "parse", "count": len(to_process),
                "elapsed": round(time.perf_counter() - t0, 2)})
    await asyncio.sleep(0)
    yield _sse({"type": "step_start", "step": "extract",
                "label": "Extracting Elements (LLM)", "total": len(to_process)})
    await asyncio.sleep(0)

    for qi, (_, fn) in enumerate(to_process):
        yield _sse({"type": "step_progress", "step": "extract",
                    "message": f"Processing '{fn}' (OCR + LLM extraction)…",
                    "current": qi, "total": len(to_process)})
        await asyncio.sleep(0)

    try:
        t_extract = time.perf_counter()
        docs, elements, new_hashes = await asyncio.to_thread(
            doc_svc.process_files, to_process, existing_hashes
        )
        for i, doc in enumerate(docs):
            yield _sse({
                "type": "step_progress", "step": "extract",
                "message": f"Extracted from '{doc.name}' — "
                           f"{len([e for e in elements if e.document_id == doc.id])} elements",
                "current": i + 1, "total": len(docs),
            })
            await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "extract", "message": str(exc)})
        await asyncio.sleep(0)
        return

    yield _sse({"type": "step_complete", "step": "extract", "count": len(elements),
                "elapsed": round(time.perf_counter() - t_extract, 2)})
    await asyncio.sleep(0)

    if not docs:
        yield _sse({"type": "pipeline_complete",
                    "summary": {"documents": 0, "elements": 0, "nodes": 0, "edges": 0,
                                "elapsed": round(time.perf_counter() - t0, 2)}})
        await asyncio.sleep(0)
        return

    # ── Step 3: Coordinated cross-document relationship extraction ──────
    yield _sse({"type": "step_start", "step": "graph",
                "label": "Building Knowledge Graph", "total": len(elements)})
    await asyncio.sleep(0)
    try:
        t_graph = time.perf_counter()
        result = _ExtractionResult(run_id=run_id, elements=elements,
                                   docs=docs, hashes=new_hashes)

        submit_task = asyncio.create_task(
            coordinator.submit_and_wait(result, workspace_id)
        )

        yield _sse({"type": "step_progress", "step": "graph",
                    "message": "Queued for cross-document analysis — waiting for peer pipelines…",
                    "current": 0, "total": len(elements)})
        await asyncio.sleep(0)

        sent_running = False
        while not submit_task.done():
            await asyncio.sleep(2.0)
            if not submit_task.done() and not sent_running:
                sent_running = True
                yield _sse({"type": "step_progress", "step": "graph",
                            "message": "Running cross-document analysis…",
                            "current": 0, "total": len(elements)})
                await asyncio.sleep(0)

        await submit_task

        relationships = result.relationships
        batch_size = result.batch_size
        batch_note = f" (batch of {batch_size})" if batch_size > 1 else ""

        yield _sse({"type": "step_progress", "step": "graph",
                    "message": f"Found {len(relationships)} cross-document relationships{batch_note} — writing graph…",
                    "current": len(elements), "total": len(elements)})
        await asyncio.sleep(0)

        async with write_lock:
            yield _sse({"type": "step_progress", "step": "graph",
                        "message": "Writing graph to Neo4j…",
                        "current": len(elements), "total": len(elements)})
            await asyncio.sleep(0)
            await asyncio.to_thread(
                graph_svc.builder.build_from_elements,
                elements, relationships, docs, workspace_id, new_hashes,
            )
            node_count = await asyncio.to_thread(graph_svc.get_node_count)

        yield _sse({"type": "step_complete", "step": "graph", "count": node_count,
                    "elapsed": round(time.perf_counter() - t_graph, 2)})
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "graph", "message": str(exc)})
        await asyncio.sleep(0)
        return

    # ── Step 4: Vector Index ────────────────────────────────────────────
    yield _sse({"type": "step_start", "step": "vector",
                "label": "Indexing Semantic Vectors", "total": len(elements)})
    await asyncio.sleep(0)
    try:
        t_vec = time.perf_counter()
        async with write_lock:
            await asyncio.to_thread(graph_svc.vector_store.upsert, elements)
        yield _sse({"type": "step_complete", "step": "vector", "count": len(elements),
                    "elapsed": round(time.perf_counter() - t_vec, 2)})
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "vector", "message": str(exc)})
        await asyncio.sleep(0)

    # ── Step 5: Coverage Assessment ─────────────────────────────────────
    yield _sse({"type": "step_start", "step": "coverage",
                "label": "Assessing Coverage", "total": 0})
    await asyncio.sleep(0)
    try:
        t_cov = time.perf_counter()
        coverage = await asyncio.to_thread(graph_svc.get_coverage_results)
        yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage),
                    "elapsed": round(time.perf_counter() - t_cov, 2)})
        await asyncio.sleep(0)
    except Exception as exc:
        yield _sse({"type": "error", "step": "coverage", "message": str(exc)})
        await asyncio.sleep(0)
        coverage = []

    yield _sse({
        "type": "pipeline_complete",
        "summary": {
            "documents": len(docs), "skipped": len(skipped), "elements": len(elements),
            "nodes": await asyncio.to_thread(graph_svc.get_node_count),
            "edges": await asyncio.to_thread(graph_svc.get_edge_count),
            "coverage_items": len(coverage),
            "elapsed": round(time.perf_counter() - t0, 2),
        },
    })
    await asyncio.sleep(0)


@router.post("/pipeline/run")
async def run_pipeline(
    workspace_id: str,
    files: list[UploadFile] = File(...),
) -> StreamingResponse:
    file_data = [(await f.read(), f.filename or "unknown") for f in files]
    return StreamingResponse(
        _stream_pipeline(workspace_id, file_data),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
