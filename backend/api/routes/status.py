"""Status and reset endpoints — workspace-scoped."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/workspaces/{workspace_id}")


@router.get("/status")
async def get_status(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        nodes = await asyncio.to_thread(gs.get_node_count)
        edges = await asyncio.to_thread(gs.get_edge_count)
        counts = await asyncio.to_thread(gs.store.get_type_counts, workspace_id)
        return {"has_data": nodes > 0, "nodes": nodes, "edges": edges, "type_counts": counts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/reset")
async def reset_workspace(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        await asyncio.to_thread(gs.reset_workspace)
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/elements")
async def get_elements(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        elements = await asyncio.to_thread(gs.get_all_elements)
        return {
            "elements": [
                {
                    "id": e.id, "type": e.type.value, "text": e.text,
                    "source": e.source, "document_id": e.document_id,
                    "confidence": e.confidence,
                }
                for e in elements
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
