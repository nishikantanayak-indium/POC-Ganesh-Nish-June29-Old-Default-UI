"""Q&A chat endpoint."""
from __future__ import annotations

from pydantic import BaseModel

from fastapi import APIRouter, HTTPException

from api.deps import get_qa_service

router = APIRouter(prefix="/api/chat")


class ChatRequest(BaseModel):
    question: str


@router.post("/ask")
def ask(req: ChatRequest) -> dict:
    """Answer a natural-language question about the knowledge graph."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        qa = get_qa_service()
        result = qa.answer(req.question)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
