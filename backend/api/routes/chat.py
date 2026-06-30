"""Chat endpoints — stateless ask + conversation-persistent history."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.deps import get_qa_service
from db.postgres import (
    add_message, count_messages, create_conversation, delete_conversation,
    get_conversation, get_messages, list_conversations, rename_conversation,
)

router = APIRouter(prefix="/api/workspaces/{workspace_id}/chat")


# ── Request / response schemas ────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str


class CreateConversationRequest(BaseModel):
    title: str = "New conversation"


class RenameRequest(BaseModel):
    title: str


# ── Stateless ask (no history) ────────────────────────────────────────────────

@router.post("/ask")
def ask(workspace_id: str, req: AskRequest) -> dict:
    """Stateless Q&A — does not persist to the database."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    try:
        return get_qa_service(workspace_id).answer(req.question)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Conversation management ───────────────────────────────────────────────────

@router.get("/conversations")
async def list_convs(workspace_id: str) -> dict:
    convs = await asyncio.to_thread(list_conversations, workspace_id)
    return {"conversations": [c.to_dict() for c in convs]}


@router.post("/conversations")
async def create_conv(workspace_id: str, req: CreateConversationRequest) -> dict:
    conv = await asyncio.to_thread(create_conversation, workspace_id, req.title)
    return conv.to_dict()


@router.patch("/conversations/{conversation_id}")
async def rename_conv(workspace_id: str, conversation_id: str, req: RenameRequest) -> dict:
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    conv = await asyncio.to_thread(rename_conversation, conversation_id, req.title)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv.to_dict()


@router.delete("/conversations/{conversation_id}")
async def delete_conv(workspace_id: str, conversation_id: str) -> dict:
    deleted = await asyncio.to_thread(delete_conversation, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


# ── Messages ──────────────────────────────────────────────────────────────────

@router.get("/conversations/{conversation_id}/messages")
async def get_msgs(workspace_id: str, conversation_id: str) -> dict:
    conv = await asyncio.to_thread(get_conversation, conversation_id)
    if conv is None or conv.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    msgs = await asyncio.to_thread(get_messages, conversation_id)
    return {"messages": [m.to_dict() for m in msgs]}


@router.post("/conversations/{conversation_id}/ask")
async def ask_in_conversation(
    workspace_id: str, conversation_id: str, req: AskRequest,
) -> dict:
    """Ask a question, persist both the user message and the AI response."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    conv = await asyncio.to_thread(get_conversation, conversation_id)
    if conv is None or conv.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Auto-title on the very first message in this conversation
    is_first = await asyncio.to_thread(count_messages, conversation_id) == 0
    if is_first:
        auto_title = req.question.strip()[:60]
        if len(req.question.strip()) > 60:
            auto_title += "…"
        await asyncio.to_thread(rename_conversation, conversation_id, auto_title)

    # Save user message
    await asyncio.to_thread(add_message, conversation_id, "user", req.question.strip())

    # Run Q&A (CPU-bound — offload to thread)
    try:
        result = await asyncio.to_thread(
            get_qa_service(workspace_id).answer, req.question
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Save assistant message with evidence
    await asyncio.to_thread(
        add_message,
        conversation_id,
        "assistant",
        result["answer"],
        result.get("query_type"),
        result.get("evidence"),
    )

    return result
