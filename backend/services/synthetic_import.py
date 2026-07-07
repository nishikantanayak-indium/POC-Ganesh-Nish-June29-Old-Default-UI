"""
Workspace-side import of a published synthetic document.

Pulls a document from the shared Synthetic Data Studio document store and
runs it through the SAME extraction path a real file upload takes
(:class:`extractors.LLMExtractor`). The actual graph write and cross-document
relationship extraction happen through the workspace's shared pipeline
coordinator (see ``api/routes/pipeline.py``) rather than a direct,
un-coordinated ``build_knowledge_graph`` call — otherwise an import running
concurrently with another import or a manual upload could each write straight
to Neo4j without ever comparing notes, so no relationship between them would
ever be extracted. Elements land tagged with a real, queryable `synthetic`
property (see `graph.neo4j_store.Neo4jGraphStore.add_element`) and the
document's display name carries a `_gen` marker.
"""
from __future__ import annotations

import hashlib
import logging

from core.models import AtomicElement, DocumentType, PageContent, ParsedDocument

logger = logging.getLogger(__name__)


def prepare_synthetic_import(
    workspace_id: str, store_document_id: str
) -> tuple[ParsedDocument, list[AtomicElement], str]:
    """Parse + LLM-extract a published synthetic document. No graph write —
    caller is responsible for submitting the result to the workspace's
    pipeline coordinator so it's merged atomically with any concurrent runs."""
    from extractors import LLMExtractor
    from synthetic import db as synthetic_db
    from synthetic.storage import get_artifact_store

    entry = synthetic_db.get_store_document(store_document_id)
    if entry is None:
        raise ValueError(f"store document {store_document_id} not found")

    store = get_artifact_store()
    markdown = store.get_bytes(entry.artifact_key).decode("utf-8")

    doc_id = f"GEN_{entry.id[:8].upper()}"
    parsed = ParsedDocument(
        id=doc_id, name=f"{entry.title} (_gen)",
        type=DocumentType(entry.doc_type), pages=[markdown], total_pages=1,
        # Without this the Elements Explorer's Text/OCR tabs show "No extracted
        # content available" — they read doc.page_contents, not doc.pages.
        # ocr_text must be "" (not None) to match the real parsers' convention.
        page_contents=[PageContent(page_num=1, native_text=markdown, ocr_text="", tables=[])],
    )
    content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()

    elements = LLMExtractor().extract_elements(parsed)
    for el in elements:
        el.metadata = {**el.metadata, "synthetic": True, "tag": "_gen"}

    logger.info(
        "Prepared synthetic document %s for import into workspace %s (%d elements)",
        store_document_id, workspace_id, len(elements),
    )
    return parsed, elements, content_hash
