"""Graph data endpoints — returns nodes/edges for React Flow rendering."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/graph")


@router.get("/data")
def get_graph_data(show_contains: bool = False) -> dict:
    """
    Return the full graph in React-Flow-compatible format.

    Query params:
        show_contains: include CONTAINS edges (default False — too noisy)
    """
    gs = get_graph_service()
    try:
        raw = gs.store.get_graph_for_visualization()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    nodes = raw.get("nodes", [])
    edges = raw.get("edges", [])

    if not show_contains:
        edges = [e for e in edges if e.get("rtype") != "CONTAINS"]

    return {"nodes": nodes, "edges": edges}


@router.get("/subgraph/{node_id}")
def get_subgraph(node_id: str) -> dict:
    """Return the ego-network (1-hop neighbourhood) around *node_id*."""
    gs = get_graph_service()
    try:
        rels = gs.store.get_relationships(node_id)
        center = gs.store.get_element(node_id)
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
        elem = gs.store.get_element(nid)
        if elem:
            nodes.append({
                "id": elem.id,
                "type": elem.type.value,
                "text": elem.text,
                "source": elem.source,
                "document_id": elem.document_id,
                "confidence": elem.confidence,
            })

    edges = [
        {
            "src": r.source_id,
            "tgt": r.target_id,
            "rtype": r.type.value,
            "conf": r.confidence,
            "ev": r.evidence,
        }
        for r in rels
    ]

    return {"nodes": nodes, "edges": edges}


@router.get("/stats")
def get_stats() -> dict:
    gs = get_graph_service()
    return {
        "nodes": gs.get_node_count(),
        "edges": gs.get_edge_count(),
        "type_counts": gs.store.get_type_counts(),
    }
