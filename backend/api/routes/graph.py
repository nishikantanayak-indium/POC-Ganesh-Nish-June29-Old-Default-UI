"""Graph data endpoints — workspace-scoped."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/workspaces/{workspace_id}/graph")


@router.get("/data")
async def get_graph_data(workspace_id: str, show_contains: bool = False) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        raw = await asyncio.to_thread(gs.store.get_graph_for_visualization, workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    nodes = raw.get("nodes", [])
    edges = raw.get("edges", [])
    if not show_contains:
        edges = [e for e in edges if e.get("rtype") != "CONTAINS"]
    return {"nodes": nodes, "edges": edges}


@router.get("/subgraph/{node_id}")
async def get_subgraph(workspace_id: str, node_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        rels = await asyncio.to_thread(gs.store.get_relationships, node_id, workspace_id)
        center = await asyncio.to_thread(gs.store.get_element, node_id, workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if center is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    node_ids: set[str] = {node_id}
    for r in rels:
        node_ids.add(r.source_id)
        node_ids.add(r.target_id)

    nodes = []
    for nid in node_ids:
        elem = await asyncio.to_thread(gs.store.get_element, nid, workspace_id)
        if elem:
            nodes.append({
                "id": elem.id, "type": elem.type.value, "text": elem.text,
                "source": elem.source, "document_id": elem.document_id,
                "confidence": elem.confidence,
            })

    edges = [
        {"src": r.source_id, "tgt": r.target_id, "rtype": r.type.value,
         "conf": r.confidence, "ev": r.evidence}
        for r in rels
    ]
    return {"nodes": nodes, "edges": edges}


@router.get("/cross-doc-relationships")
async def get_cross_doc_relationships(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        rows = await asyncio.to_thread(
            gs.store.get_cross_document_relationships, workspace_id
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"relationships": rows, "total": len(rows)}


@router.get("/stats")
async def get_stats(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    return {
        "nodes": await asyncio.to_thread(gs.get_node_count),
        "edges": await asyncio.to_thread(gs.get_edge_count),
        "type_counts": await asyncio.to_thread(gs.store.get_type_counts, workspace_id),
    }
