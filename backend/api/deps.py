"""
Singleton service instances for the FastAPI layer.

Each getter returns the same object for the lifetime of the process,
mirroring Streamlit's @st.cache_resource behaviour.

Run uvicorn from the backend/ directory so all package imports resolve
naturally without sys.path manipulation:
    cd backend && uvicorn api.main:app --reload --port 8000
"""
from __future__ import annotations

from services.document_service import DocumentService
from services.graph_service import GraphService
from services.qa_service import QAService

_doc_service: DocumentService | None = None
_graph_service: GraphService | None = None


def get_doc_service() -> DocumentService:
    global _doc_service
    if _doc_service is None:
        _doc_service = DocumentService()
    return _doc_service


def get_graph_service() -> GraphService:
    global _graph_service
    if _graph_service is None:
        _graph_service = GraphService()
    return _graph_service


def get_qa_service() -> QAService:
    gs = get_graph_service()
    return QAService(gs.store, gs.builder, gs.graphiti, gs.vector_store)
