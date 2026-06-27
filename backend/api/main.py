"""
FastAPI application entry point for the GraphRAG Procurement API.

Run with:
    uvicorn api.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import pipeline, graph, traceability, chat, status

app = FastAPI(
    title="GraphRAG Procurement API",
    version="1.0.0",
    description="Knowledge graph API for procurement document analysis",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline.router)
app.include_router(graph.router)
app.include_router(traceability.router)
app.include_router(chat.router)
app.include_router(status.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "graphrag-api"}
