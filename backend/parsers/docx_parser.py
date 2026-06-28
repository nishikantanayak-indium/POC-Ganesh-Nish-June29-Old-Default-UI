"""
DOCX document parser using python-docx.

Implements :class:`core.interfaces.IParser` for `.docx` files.
Paragraphs are accumulated into synthetic pages: a new page boundary is
started whenever the running character total reaches or exceeds
``PAGE_CHAR_LIMIT`` (3 000 characters), matching the project chunk size.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import BinaryIO, List

from docx import Document as _DocxDoc

from core.exceptions import ParseError
from core.interfaces import IParser
from core.models import DocumentType, ParsedDocument
from .pdf_parser import _build_document_id, _infer_document_type

# Synthetic page size in characters (mirrors settings.max_chunk_chars)
PAGE_CHAR_LIMIT: int = 3_000


class DOCXParser(IParser):
    """Parse DOCX files into :class:`~core.models.ParsedDocument` objects."""

    # ------------------------------------------------------------------
    # IParser contract
    # ------------------------------------------------------------------

    def supports(self, filename: str) -> bool:
        """Return ``True`` for any filename ending in ``.docx`` (case-insensitive)."""
        return Path(filename).suffix.lower() == ".docx"

    def parse(self, file: BinaryIO, filename: str, progress_cb=None) -> ParsedDocument:
        """
        Extract paragraph text from a DOCX file and group it into synthetic
        pages of up to ``PAGE_CHAR_LIMIT`` characters each.

        Parameters
        ----------
        file:
            Open binary stream of the DOCX, positioned at byte 0.
        filename:
            Original filename; used to derive the document type and ID.

        Returns
        -------
        ParsedDocument
            ``pages`` is a list of page-text strings, each at most
            ``PAGE_CHAR_LIMIT`` characters (unless a single paragraph
            exceeds that limit by itself).

        Raises
        ------
        core.exceptions.ParseError
            Wraps any underlying :mod:`docx` or I/O error.
        """
        try:
            raw: bytes = file.read()
            docx_doc = _DocxDoc(io.BytesIO(raw))

            # Collect non-empty paragraph texts
            paragraphs: List[str] = [
                p.text.strip()
                for p in docx_doc.paragraphs
                if p.text.strip()
            ]

            pages = _group_into_pages(paragraphs, PAGE_CHAR_LIMIT)

            doc_type: DocumentType = _infer_document_type(filename)
            doc_id: str = _build_document_id(filename)

            return ParsedDocument(
                id=doc_id,
                name=filename,
                type=doc_type,
                pages=pages,
                total_pages=len(pages),
            )

        except Exception as exc:
            raise ParseError(
                f"Failed to parse DOCX '{filename}': {exc}"
            ) from exc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _group_into_pages(paragraphs: List[str], limit: int) -> List[str]:
    """
    Accumulate *paragraphs* into page strings.

    A new page is started when the current page's character count reaches
    or exceeds *limit*.  Each paragraph is separated from the previous one
    by a newline.  An empty paragraph list produces a single empty-string
    page so that ``ParsedDocument`` invariants still hold.

    Parameters
    ----------
    paragraphs:
        Non-empty stripped paragraph strings.
    limit:
        Character threshold at which to close the current page and open a
        new one.

    Returns
    -------
    list[str]
        At least one element.
    """
    if not paragraphs:
        return [""]

    pages: List[str] = []
    current_chunks: List[str] = []
    current_len: int = 0

    for para in paragraphs:
        # If adding this paragraph would exceed the limit, flush the current page
        # (but only if there is already content — never emit an empty page mid-stream)
        if current_len >= limit and current_chunks:
            pages.append("\n".join(current_chunks))
            current_chunks = []
            current_len = 0

        current_chunks.append(para)
        current_len += len(para)

    # Flush the final page
    if current_chunks:
        pages.append("\n".join(current_chunks))

    return pages
