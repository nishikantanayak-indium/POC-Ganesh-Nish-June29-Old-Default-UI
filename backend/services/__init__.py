"""
Services package for the GraphRAG POC.

Three stateless-ish service objects that form the application layer between
the Streamlit UI and the infrastructure layer (parsers, extractors, graph
store, vector store, LLM):

* :class:`DocumentService`  — parse files and extract typed elements
* :class:`GraphService`     — build and query the knowledge graph
* :class:`QAService`        — intent-aware question-answering over the graph
"""

from .document_service import DocumentService
from .graph_service import GraphService
from .qa_service import QAService

__all__ = ["DocumentService", "GraphService", "QAService"]
