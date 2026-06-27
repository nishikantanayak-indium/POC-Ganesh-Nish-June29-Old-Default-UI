"""Status and reset endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api")


@router.get("/status")
def get_status() -> dict:
    """Return current graph state — used on app startup."""
    gs = get_graph_service()
    try:
        nodes = gs.get_node_count()
        edges = gs.get_edge_count()
        counts = gs.store.get_type_counts()
        return {
            "has_data": nodes > 0,
            "nodes": nodes,
            "edges": edges,
            "type_counts": counts,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/reset")
def reset_graph() -> dict:
    """Permanently wipe all Neo4j nodes and Qdrant vectors."""
    gs = get_graph_service()
    try:
        gs.reset_graph()
        return {"success": True, "message": "Graph and vector store cleared"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/debug/edges")
def debug_edges() -> dict:
    """Return all edges grouped by relationship type — useful for diagnosing coverage."""
    gs = get_graph_service()
    try:
        with gs.store._driver.session(database=gs.store._db) as s:
            result = s.run(
                "MATCH (a:Element)-[r]->(b:Element) "
                "RETURN type(r) AS rtype, a.id AS src, b.id AS tgt, "
                "       a.type AS src_type, b.type AS tgt_type, r.confidence AS conf "
                "ORDER BY rtype, src"
            )
            edges = [dict(r) for r in result]
        by_type: dict[str, list] = {}
        for e in edges:
            by_type.setdefault(e["rtype"], []).append(e)
        summary = {k: len(v) for k, v in by_type.items()}
        return {"summary": summary, "edges": edges}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/elements")
def get_elements() -> dict:
    """Return all non-Document elements from Neo4j."""
    gs = get_graph_service()
    try:
        elements = gs.get_all_elements()
        return {
            "elements": [
                {
                    "id": e.id,
                    "type": e.type.value,
                    "text": e.text,
                    "source": e.source,
                    "document_id": e.document_id,
                    "confidence": e.confidence,
                }
                for e in elements
            ]
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
