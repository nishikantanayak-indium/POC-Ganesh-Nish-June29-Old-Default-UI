"""Coverage and traceability endpoints."""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/traceability")


@router.get("/coverage")
def get_coverage() -> dict:
    """Return coverage results for all requirements."""
    gs = get_graph_service()
    try:
        results = gs.get_coverage_results()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "results": [
            {
                "requirement_id": r.requirement_id,
                "requirement_text": r.requirement_text,
                "status": r.status.value,
                "covering_clauses": r.covering_clauses,
                "risks": r.risks,
                "mitigations": r.mitigations,
                "lds": r.lds,
                "source": r.source,
            }
            for r in results
        ]
    }


@router.get("/chain/{req_id}")
def get_chain(req_id: str) -> dict:
    """Return the full traceability chain for requirement *req_id*."""
    gs = get_graph_service()
    try:
        chain = gs.get_traceability(req_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not chain:
        raise HTTPException(status_code=404, detail=f"Requirement '{req_id}' not found")

    return chain
