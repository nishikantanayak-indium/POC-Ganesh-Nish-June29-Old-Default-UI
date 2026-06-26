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
    ) -> tuple[list[ParsedDocument], list[AtomicElement]]:
        """
        Parse and extract elements from multiple files in order.

        Parameters
        ----------
        files:
            A list of ``(file_bytes, filename)`` pairs.

        Returns
        -------
        tuple[list[ParsedDocument], list[AtomicElement]]
            All parsed documents and the union of all extracted elements.
            Documents and elements are ordered to match the input order.
        """
        all_docs: list[ParsedDocument] = []
        all_elements: list[AtomicElement] = []

        for file_bytes, filename in files:
            doc, elements = self.process_file(file_bytes, filename)
            all_docs.append(doc)
            all_elements.extend(elements)

        logger.info(
            "Processed %d file(s) → %d documents, %d elements total",
            len(files),
            len(all_docs),
            len(all_elements),
        )
        return all_docs, all_elements

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
