"""
PDF document parser using PyMuPDF (fitz).

Implements :class:`core.interfaces.IParser` for `.pdf` files.
Text is extracted page-by-page; near-blank pages (< 20 chars of content)
are filtered out before the :class:`~core.models.ParsedDocument` is built.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import BinaryIO

import fitz  # PyMuPDF

from core.exceptions import ParseError
from core.interfaces import IParser
from core.models import DocumentType, ParsedDocument


class PDFParser(IParser):
    """Parse PDF files into :class:`~core.models.ParsedDocument` objects."""

    # ------------------------------------------------------------------
    # IParser contract
    # ------------------------------------------------------------------

    def supports(self, filename: str) -> bool:
        """Return ``True`` for any filename ending in ``.pdf`` (case-insensitive)."""
        return Path(filename).suffix.lower() == ".pdf"

    def parse(self, file: BinaryIO, filename: str) -> ParsedDocument:
        """
        Extract text from every page of a PDF and return a
        :class:`~core.models.ParsedDocument`.

        Parameters
        ----------
        file:
            Open binary stream of the PDF, positioned at byte 0.
        filename:
            Original filename; used to derive the document type and ID.

        Returns
        -------
        ParsedDocument
            Pages with fewer than 20 non-whitespace characters are dropped.

        Raises
        ------
        core.exceptions.ParseError
            Wraps any underlying :mod:`fitz` or I/O error.
        """
        try:
            data: bytes = file.read()
            pdf_doc = fitz.open(stream=data, filetype="pdf")

            pages = [
                page.get_text("text")
                for page in pdf_doc
            ]

            # Filter near-blank pages
            pages = [text for text in pages if len(text.strip()) >= 20]

            doc_type = _infer_document_type(filename)
            doc_id = _build_document_id(filename)

            return ParsedDocument(
                id=doc_id,
                name=filename,
                type=doc_type,
                pages=pages,
                total_pages=len(pages),
            )

        except Exception as exc:
            raise ParseError(
                f"Failed to parse PDF '{filename}': {exc}"
            ) from exc


# ---------------------------------------------------------------------------
# Shared helpers (used by docx_parser as well via import)
# ---------------------------------------------------------------------------

def _infer_document_type(filename: str) -> DocumentType:
    """
    Map a filename to a :class:`~core.models.DocumentType` using simple
    keyword matching on the lowercased stem.

    Priority order (first match wins):
    1. RFP  — ``rfp``, ``rfx``, ``tender``
    2. RISK_SHEET — ``risk``, ``rmc``, ``register``
    3. CONTRACT — ``contract``, ``offer``, ``agreement``, ``purchase``
    4. Default → RFP
    """
    name_lower = Path(filename).stem.lower()

    rfp_keywords = ("rfp", "rfx", "tender")
    risk_keywords = ("risk", "rmc", "register")
    contract_keywords = ("contract", "offer", "agreement", "purchase")

    if any(kw in name_lower for kw in rfp_keywords):
        return DocumentType.RFP
    if any(kw in name_lower for kw in risk_keywords):
        return DocumentType.RISK_SHEET
    if any(kw in name_lower for kw in contract_keywords):
        return DocumentType.CONTRACT
    return DocumentType.RFP


def _build_document_id(filename: str) -> str:
    """
    Build a stable, filesystem-safe document ID from a filename.

    Steps:
    1. Take the stem (no extension), lowercase.
    2. Replace runs of spaces and hyphens with ``_``.
    3. Strip any remaining non-alphanumeric/underscore characters.
    4. Prefix with ``DOC_``.
    """
    stem = Path(filename).stem.lower()
    stem = re.sub(r"[\s\-]+", "_", stem)
    stem = re.sub(r"[^a-z0-9_]", "", stem)
    return "DOC_" + stem
