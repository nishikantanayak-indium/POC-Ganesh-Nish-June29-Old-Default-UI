"""
Workspace-side import of a published synthetic document.

Pulls a document from the shared Synthetic Data Studio document store and
runs it through the SAME extraction + graph-build path a real file upload
takes (:class:`extractors.LLMExtractor` → :meth:`GraphService.build_knowledge_graph`),
so ingestion is genuinely exercised end-to-end rather than the document being
injected as a shortcut. Elements land tagged with a real, queryable
`synthetic` property (see `graph.neo4j_store.Neo4jGraphStore.add_element`) and
the document's display name carries a `_gen` marker.
"""
from __future__ import annotations

import hashlib
import logging

from core.models import DocumentType, ParsedDocument
from extractors import LLMExtractor
from synthetic import db as synthetic_db
from synthetic.storage import get_artifact_store

logger = logging.getLogger(__name__)

_extractor = LLMExtractor()  # amortise OpenAI client init, same pattern as DocumentService


def import_synthetic_document(workspace_id: str, store_document_id: str) -> dict:
    entry = synthetic_db.get_store_document(store_document_id)
    if entry is None:
        raise ValueError(f"store document {store_document_id} not found")

    store = get_artifact_store()
    markdown = store.get_bytes(entry.artifact_key).decode("utf-8")

    doc_id = f"GEN_{entry.id[:8].upper()}"
    parsed = ParsedDocument(
        id=doc_id, name=f"{entry.title} (_gen)",
        type=DocumentType(entry.doc_type), pages=[markdown], total_pages=1,
    )
    content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()

    elements = _extractor.extract_elements(parsed)
    for el in elements:
        el.metadata = {**el.metadata, "synthetic": True, "tag": "_gen"}

    from api.deps import get_graph_service  # lazy import — avoid an import cycle
    gs = get_graph_service(workspace_id)
    gs.build_knowledge_graph([parsed], elements, [], {doc_id: content_hash})

    synthetic_db.mark_store_document_imported(store_document_id, workspace_id)

    logger.info(
        "Imported synthetic document %s into workspace %s (%d elements)",
        store_document_id, workspace_id, len(elements),
    )
    return {
        "workspace_id": workspace_id, "document_id": doc_id, "title": parsed.name,
        "elements": len(elements),
        "nodes": gs.get_node_count(), "edges": gs.get_edge_count(),
    }
