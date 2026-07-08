"""Workspace CRUD endpoints."""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.deps import evict_workspace, get_graph_service
from db.postgres import (
    create_workspace, delete_workspace, get_workspace,
    list_workspaces, update_workspace,
)

router = APIRouter(prefix="/api/workspaces")


class WorkspaceCreate(BaseModel):
    name: str
    description: str = ""


class WorkspaceUpdate(BaseModel):
    name: str
    description: str = ""


@router.get("")
async def list_ws() -> dict:
    workspaces = await asyncio.to_thread(list_workspaces)
    return {"workspaces": [w.to_dict() for w in workspaces]}


@router.post("")
async def create_ws(body: WorkspaceCreate) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    ws = await asyncio.to_thread(create_workspace, body.name, body.description)
    return ws.to_dict()


@router.get("/{workspace_id}")
async def get_ws(workspace_id: str) -> dict:
    ws = await asyncio.to_thread(get_workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws.to_dict()


@router.patch("/{workspace_id}")
async def update_ws(workspace_id: str, body: WorkspaceUpdate) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    ws = await asyncio.to_thread(update_workspace, workspace_id, body.name, body.description)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws.to_dict()


async def _stream_import_synthetic(workspace_id: str, store_document_id: str) -> AsyncGenerator[str, None]:
    """Pull a published synthetic document from the shared Studio document
    store into this workspace, running it through the real extraction
    pipeline (same path a real file upload takes) and merging it through the
    workspace's shared pipeline coordinator — so concurrent imports/uploads
    into the same workspace still get their cross-document relationships
    extracted, instead of each racing straight to Neo4j on its own.

    Streams the exact same event shape as ``pipeline.py::_stream_pipeline``
    so the frontend drives both through one shared job runner — a synthetic
    import gets the same step tracker + live log as a manual upload, not a
    lookalike."""
    from api.routes.pipeline import _ExtractionResult, _get_write_lock, _sse, get_coordinator
    from services.synthetic_import import prepare_synthetic_import
    from synthetic import db as synthetic_db

    t0 = time.perf_counter()
    gs = get_graph_service(workspace_id)

    yield _sse({"type": "step_start", "step": "parse", "label": "Preparing Document", "total": 1})
    await asyncio.sleep(0)
    t_step = time.perf_counter()
    try:
        parsed, elements, content_hash = await asyncio.to_thread(
            prepare_synthetic_import, workspace_id, store_document_id
        )
    except Exception as exc:
        yield _sse({"type": "error", "step": "parse", "message": str(exc)})
        return
    yield _sse({"type": "step_complete", "step": "parse", "count": 1,
                "elapsed": round(time.perf_counter() - t_step, 2)})
    await asyncio.sleep(0)

    yield _sse({"type": "step_start", "step": "extract", "label": "Extracting Elements (LLM)", "total": 1})
    await asyncio.sleep(0)
    yield _sse({"type": "step_complete", "step": "extract", "count": len(elements),
                "elapsed": round(time.perf_counter() - t_step, 2)})
    await asyncio.sleep(0)

    yield _sse({"type": "step_start", "step": "graph", "label": "Building Knowledge Graph", "total": len(elements)})
    await asyncio.sleep(0)
    t_step = time.perf_counter()
    try:
        result = _ExtractionResult(
            run_id=str(uuid.uuid4()), elements=elements, docs=[parsed],
            hashes={parsed.id: content_hash},
        )
        await get_coordinator(workspace_id).submit_and_wait(result, workspace_id)
    except Exception as exc:
        yield _sse({"type": "error", "step": "graph", "message": str(exc)})
        return
    yield _sse({"type": "step_complete", "step": "graph", "count": result.node_count,
                "elapsed": round(time.perf_counter() - t_step, 2)})
    await asyncio.sleep(0)

    yield _sse({"type": "step_start", "step": "vector", "label": "Indexing Semantic Vectors", "total": len(elements)})
    await asyncio.sleep(0)
    t_step = time.perf_counter()
    try:
        async with _get_write_lock(workspace_id):
            await asyncio.to_thread(gs.vector_store.upsert, elements)
    except Exception as exc:
        yield _sse({"type": "error", "step": "vector", "message": str(exc)})
        return
    yield _sse({"type": "step_complete", "step": "vector", "count": len(elements),
                "elapsed": round(time.perf_counter() - t_step, 2)})
    await asyncio.sleep(0)

    yield _sse({"type": "step_start", "step": "coverage", "label": "Assessing Coverage", "total": 0})
    await asyncio.sleep(0)
    t_step = time.perf_counter()
    coverage = await asyncio.to_thread(gs.get_coverage_results)
    yield _sse({"type": "step_complete", "step": "coverage", "count": len(coverage),
                "elapsed": round(time.perf_counter() - t_step, 2)})
    await asyncio.sleep(0)

    await asyncio.to_thread(synthetic_db.mark_store_document_imported, store_document_id, workspace_id)

    yield _sse({
        "type": "pipeline_complete",
        "workspace_id": workspace_id,
        "summary": {
            "documents": 1, "elements": len(elements),
            "nodes": result.node_count, "edges": result.edge_count,
            "coverage_items": len(coverage),
            "elapsed": round(time.perf_counter() - t0, 2),
        },
    })


@router.post("/{workspace_id}/import-synthetic/{store_document_id}")
async def import_synthetic(workspace_id: str, store_document_id: str) -> StreamingResponse:
    from synthetic import db as synthetic_db

    entry = await asyncio.to_thread(synthetic_db.get_store_document, store_document_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"store document {store_document_id} not found")

    return StreamingResponse(
        _stream_import_synthetic(workspace_id, store_document_id),
        media_type="text/event-stream",
    )


@router.delete("/{workspace_id}")
async def delete_ws(workspace_id: str) -> dict:
    # Clear all graph + vector data for this workspace
    try:
        gs = get_graph_service(workspace_id)
        await asyncio.to_thread(gs.reset_workspace)
    except Exception:
        pass  # proceed with DB deletion even if store cleanup fails
    evict_workspace(workspace_id)

    deleted = await asyncio.to_thread(delete_workspace, workspace_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"deleted": True}
