"""Workspace CRUD endpoints."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
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


@router.post("/{workspace_id}/import-synthetic/{store_document_id}")
async def import_synthetic(workspace_id: str, store_document_id: str) -> dict:
    """Pull a published synthetic document from the shared Studio document
    store into this workspace, running it through the real extraction
    pipeline (same path a real file upload takes) and merging it through the
    workspace's shared pipeline coordinator — so concurrent imports/uploads
    into the same workspace still get their cross-document relationships
    extracted, instead of each racing straight to Neo4j on its own."""
    import uuid

    from api.routes.pipeline import _ExtractionResult, _get_write_lock, get_coordinator
    from services.synthetic_import import prepare_synthetic_import
    from synthetic import db as synthetic_db

    try:
        parsed, elements, content_hash = await asyncio.to_thread(
            prepare_synthetic_import, workspace_id, store_document_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    result = _ExtractionResult(
        run_id=str(uuid.uuid4()), elements=elements, docs=[parsed],
        hashes={parsed.id: content_hash},
    )
    await get_coordinator(workspace_id).submit_and_wait(result, workspace_id)

    gs = get_graph_service(workspace_id)
    async with _get_write_lock(workspace_id):
        await asyncio.to_thread(gs.vector_store.upsert, elements)

    await asyncio.to_thread(synthetic_db.mark_store_document_imported, store_document_id, workspace_id)

    return {
        "workspace_id": workspace_id, "document_id": parsed.id, "title": parsed.name,
        "elements": len(elements),
        "nodes": result.node_count, "edges": result.edge_count,
    }


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
