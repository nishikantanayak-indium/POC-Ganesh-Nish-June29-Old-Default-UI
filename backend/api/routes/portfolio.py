"""Portfolio summary — coverage/gap/contradiction stats across all workspaces.

Lets a user comparing multiple deals see coverage %, outstanding gaps, and
contradiction counts side by side, instead of opening each workspace one at
a time. Computed on-demand by reusing the same grounding-bundle logic the
Contract Draft feature already needs (services/contract_draft_service.py) —
no separate aggregation pipeline, no cache/materialized table. Fine at the
realistic scale of a handful of concurrent deals; if this is ever used with
dozens+ of workspaces, a cached summary would be the next step.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from api.deps import get_contract_draft_service, get_graph_service
from db import postgres as db

router = APIRouter(prefix="/api/portfolio")


def _summarize(workspace) -> dict | None:
    gs = get_graph_service(workspace.id)
    try:
        nodes = gs.get_node_count()
    except Exception:
        return None
    if nodes == 0:
        return {
            "workspace_id": workspace.id, "name": workspace.name,
            "updated_at": workspace.updated_at.isoformat(),
            "nodes": 0, "edges": 0,
            "requirements_total": 0, "requirements_covered": 0,
            "requirements_needing_attention": 0, "gaps_count": 0,
            "contradictions_count": 0,
        }

    svc = get_contract_draft_service()
    try:
        bundle = svc.build_grounding_bundle(gs)
        contradictions = gs.get_contradictions()
    except Exception:
        bundle = {"summary": {
            "requirements_total": 0, "requirements_covered": 0,
            "requirements_needing_attention": 0, "gaps_count": 0,
        }}
        contradictions = []

    return {
        "workspace_id": workspace.id, "name": workspace.name,
        "updated_at": workspace.updated_at.isoformat(),
        "nodes": nodes, "edges": gs.get_edge_count(),
        **bundle["summary"],
        "contradictions_count": len(contradictions),
    }


@router.get("")
async def get_portfolio() -> dict:
    workspaces = await asyncio.to_thread(db.list_workspaces)
    summaries = await asyncio.to_thread(lambda: [s for w in workspaces if (s := _summarize(w)) is not None])
    return {"workspaces": summaries}
