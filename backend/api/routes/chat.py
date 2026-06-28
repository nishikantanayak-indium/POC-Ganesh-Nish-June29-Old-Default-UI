"""Q&A chat endpoint — workspace-scoped."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.deps import get_qa_service

router = APIRouter(prefix="/api/workspaces/{workspace_id}/chat")


class ChatRequest(BaseModel):
    question: str


@router.post("/ask")
def ask(workspace_id: str, req: ChatRequest) -> dict:
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        return get_qa_service(workspace_id).answer(req.question)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
