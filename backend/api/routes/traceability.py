"""Coverage and traceability endpoints — workspace-scoped."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/workspaces/{workspace_id}/traceability")


@router.get("/coverage")
async def get_coverage(workspace_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        results = await asyncio.to_thread(gs.get_coverage_results)
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
async def get_chain(workspace_id: str, req_id: str) -> dict:
    gs = get_graph_service(workspace_id)
    try:
        chain = await asyncio.to_thread(gs.get_traceability, req_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not chain:
        raise HTTPException(status_code=404, detail=f"Requirement '{req_id}' not found")
    return chain
