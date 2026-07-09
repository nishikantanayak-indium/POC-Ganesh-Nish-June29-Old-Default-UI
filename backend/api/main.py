"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    chat, contract_draft, documents, graph, pipeline, portfolio, status, synthetic, traceability, workspaces,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="ContractIQ API",
    version="2.0.0",
    description="Contract intelligence platform — knowledge-graph Analysis + Synthetic Data Studio",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workspaces.router)
app.include_router(pipeline.router)
app.include_router(graph.router)
app.include_router(traceability.router)
app.include_router(chat.router)
app.include_router(status.router)
app.include_router(documents.router)
app.include_router(synthetic.router)
app.include_router(contract_draft.router)
app.include_router(portfolio.router)


@app.on_event("startup")
async def startup() -> None:
    try:
        from db.postgres import init_db
        await asyncio.to_thread(init_db)
        logger.info("PostgreSQL workspace table ready")
    except Exception as exc:
        logger.warning("Could not initialize PostgreSQL (workspace CRUD unavailable): %s", exc)

    try:
        from synthetic.db import init_synthetic_db
        await asyncio.to_thread(init_synthetic_db)
        logger.info("Synthetic Data Studio tables ready")
    except Exception as exc:
        logger.warning("Could not initialize Synthetic Data Studio tables: %s", exc)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "graphrag-api", "version": "2.0.0"}
