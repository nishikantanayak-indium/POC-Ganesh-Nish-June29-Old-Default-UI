"""
Document service: file parsing and LLM-powered element extraction.

This service is the entry point for ingesting raw document bytes.  It
delegates to:

* :class:`parsers.ParserFactory`   — selects the correct file parser (PDF/DOCX)
* :class:`extractors.LLMExtractor` — extracts typed atomic elements and
                                      cross-document relationships via GPT-4o

Typical call sequence
---------------------
1. ``process_files([(bytes, name), ...])``
   → returns ``(list[ParsedDocument], list[AtomicElement])``

2. ``extract_cross_document_relationships(elements)``
   → returns ``list[Relationship]``

These outputs are then handed off to :class:`~services.graph_service.GraphService`.
"""

from __future__ import annotations

import hashlib
import io
import logging
from typing import TYPE_CHECKING

from parsers import ParserFactory
from extractors import LLMExtractor
from core.models import (
    AtomicElement,
    ExtractionResult,
    ParsedDocument,
    Relationship,
)

if TYPE_CHECKING:
    pass  # kept for future type-only imports

logger = logging.getLogger(__name__)


class DocumentService:
    """
    Orchestrates document parsing and element extraction.

    A single :class:`~extractors.LLMExtractor` instance is shared across
    all calls to amortise the OpenAI client initialisation cost.
    """

    def __init__(self) -> None:
        self._extractor: LLMExtractor = LLMExtractor()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_hash(file_bytes: bytes) -> str:
        return hashlib.sha256(file_bytes).hexdigest()

    def process_file(
        self,
        file_bytes: bytes,
        filename: str,
    ) -> tuple[ParsedDocument, list[AtomicElement]]:
        """
        Parse a single file and extract its typed atomic elements.

        Parameters
        ----------
        file_bytes:
            Raw bytes of the uploaded file.
        filename:
            Original filename including extension (used to select the parser
            and to derive ``ParsedDocument.name``).

        Returns
        -------
        tuple[ParsedDocument, list[AtomicElement]]
            The parsed document representation and its extracted elements.

        Raises
        ------
        core.exceptions.UnsupportedFileTypeError
            If no registered parser handles the file extension.
        core.exceptions.ExtractionError
            If the LLM extraction call fails.
        """
        logger.info("Processing file: %s (%d bytes)", filename, len(file_bytes))
        parser = ParserFactory.get_parser(filename)
        doc: ParsedDocument = parser.parse(io.BytesIO(file_bytes), filename)
        logger.info(
            "Parsed '%s': %d pages, type=%s",
            doc.name,
            doc.total_pages,
            doc.type.value,
        )
        elements: list[AtomicElement] = self._extractor.extract_elements(doc)
        logger.info(
            "Extracted %d elements from '%s'",
            len(elements),
            doc.name,
        )
        return doc, elements

    def process_files(
        self,
        files: list[tuple[bytes, str]],
        existing_hashes: dict[str, str] | None = None,
    ) -> tuple[list[ParsedDocument], list[AtomicElement], dict[str, str]]:
        """
        Parse and extract elements from multiple files, skipping already-ingested ones.

        Parameters
        ----------
        files:
            A list of ``(file_bytes, filename)`` pairs.
        existing_hashes:
            Optional ``{doc_id: sha256_hex}`` map from Neo4j.  Files whose
            SHA-256 matches a stored hash are skipped (they are already in the
            graph and the content-hash IDs guarantee idempotent MERGEs).

        Returns
        -------
        tuple[list[ParsedDocument], list[AtomicElement], dict[str, str]]
            - New/changed documents processed this run
            - Extracted elements for those documents
            - ``{doc_id: sha256_hex}`` for the newly processed documents
        """
        all_docs: list[ParsedDocument] = []
        all_elements: list[AtomicElement] = []
        new_hashes: dict[str, str] = {}

        # Build reverse map: hash → doc_id so we can skip efficiently
        known: set[str] = set((existing_hashes or {}).values())

        for file_bytes, filename in files:
            file_hash = self._compute_hash(file_bytes)
            if file_hash in known:
                logger.info("Skipping '%s' — already ingested (hash match)", filename)
                continue
            doc, elements = self.process_file(file_bytes, filename)
            new_hashes[doc.id] = file_hash
            all_docs.append(doc)
            all_elements.extend(elements)

        logger.info(
            "Processed %d new file(s) → %d documents, %d elements total "
            "(%d skipped as duplicates)",
            len(all_docs),
            len(all_docs),
            len(all_elements),
            len(files) - len(all_docs),
        )
        return all_docs, all_elements, new_hashes

    def extract_cross_document_relationships(
        self,
        elements: list[AtomicElement],
    ) -> list[Relationship]:
        """
        Infer semantic relationships across *all* extracted elements.

        This is run once after all documents have been processed so that the
        LLM has visibility of the complete element vocabulary when inferring
        cross-document links (e.g. a contract Clause covering an RFP
        Requirement from a different document).

        Parameters
        ----------
        elements:
            The complete list of :class:`~core.models.AtomicElement` objects
            extracted from all uploaded documents.

        Returns
        -------
        list[Relationship]
            Inferred typed directed relationships (confidence >= threshold).

        Raises
        ------
        core.exceptions.ExtractionError
            If the LLM relationship extraction call fails.
        """
        logger.info(
            "Inferring cross-document relationships for %d elements", len(elements)
        )
        relationships: list[Relationship] = self._extractor.extract_relationships(
            elements
        )
        logger.info("Found %d cross-document relationships", len(relationships))
        return relationships
