"""Document content endpoints — workspace-scoped.

Exposes the raw parsed content (native text, OCR text, extracted tables)
stored on Document nodes so the frontend Document Explorer can display it.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from api.deps import get_graph_service

router = APIRouter(prefix="/api/workspaces/{workspace_id}/documents")


@router.get("")
async def get_documents(workspace_id: str) -> dict:
    """Return all ingested documents with their per-page content.

    Each document entry contains:
    - ``id`` / ``name`` / ``type`` / ``total_pages``
    - ``page_contents``: list of ``{page_num, native_text, ocr_text, tables}``
      where each table is ``{page, headers, rows}``.
    """
    gs = get_graph_service(workspace_id)
    try:
        docs = await asyncio.to_thread(gs.store.get_document_contents, workspace_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"documents": docs}
