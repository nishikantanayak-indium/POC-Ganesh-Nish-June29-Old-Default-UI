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
from typing import List, Tuple

from core.models import AtomicElement, DocumentType, PageContent, ParsedDocument

logger = logging.getLogger(__name__)


def _split_into_sections(markdown: str) -> Tuple[List[str], List[str]]:
    """Split generated markdown into one page-text block per ``## heading``,
    returning ``(headings, page_texts)`` aligned 1:1 by index.

    The extractor's own section-heading regex (``_SECTION_RE`` in
    ``extractors/llm_extractor.py``) only matches legal-drafting-style numbered
    headings ("Section 3.2", "APPENDIX A") — a generic markdown heading like
    "## Introduction" never matches it, so relying on auto-detection here would
    just collapse every synthetic document into one generic "General" section.
    We already know the real heading text (the generator wrote it), so we seed
    it directly instead of guessing."""
    headings: List[str] = []
    pages: List[str] = []
    current: List[str] | None = None
    for line in markdown.split("\n"):
        if line.startswith("## "):
            if current is not None:
                pages.append("\n".join(current))
            headings.append(line[3:].strip())
            current = [line]
        elif current is not None:
            current.append(line)
        # else: preamble before the first heading (title/brief line) — discarded,
        # it doesn't belong to any section.
    if current is not None:
        pages.append("\n".join(current))
    if not headings:
        return [], [markdown]
    return headings, pages


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
    headings, pages = _split_into_sections(markdown)

    doc_id = f"GEN_{entry.id[:8].upper()}"
    parsed = ParsedDocument(
        id=doc_id, name=f"{entry.title} (_gen)",
        type=DocumentType(entry.doc_type), pages=pages, total_pages=len(pages),
        # Without this the Elements Explorer's Text/OCR tabs show "No extracted
        # content available" — they read doc.page_contents, not doc.pages.
        # ocr_text must be "" (not None) to match the real parsers' convention.
        page_contents=[
            PageContent(page_num=i + 1, native_text=p, ocr_text="", tables=[])
            for i, p in enumerate(pages)
        ],
    )
    content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()

    elements = LLMExtractor().extract_elements(parsed)
    for el in elements:
        el.metadata = {**el.metadata, "synthetic": True, "tag": "_gen"}
        # A generated document was never paginated — the extractor's
        # "page_number" here is really just the index of the section-block we
        # split it into above, not a real page. Showing "(p.3)" to a reviewer
        # would imply a physical page 3 exists, which it doesn't. Replace it
        # with the document's own real heading (known exactly, not guessed)
        # and drop the fabricated page number from both the citation string
        # and the metadata entirely.
        idx = el.metadata.pop("page_number", None)
        heading = headings[idx - 1] if idx and 1 <= idx <= len(headings) else None
        if heading:
            el.metadata["section"] = heading
            el.source = f"{parsed.name} — {heading}"
        else:
            el.metadata.pop("section", None)
            el.source = parsed.name

    logger.info(
        "Prepared synthetic document %s for import into workspace %s (%d elements, %d sections)",
        store_document_id, workspace_id, len(elements), len(headings),
    )
    return parsed, elements, content_hash
