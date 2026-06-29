"""
DOCX document parser using python-docx.

Implements :class:`core.interfaces.IParser` for `.docx` files.

Two-pass extraction:
1. Paragraphs and tables are iterated in document order via the XML body.
   Paragraphs are accumulated into synthetic pages (capped at PAGE_CHAR_LIMIT
   characters each).  Tables are associated with whichever synthetic page is
   current when they appear in the document.
2. Extracted tables are stored as :class:`~core.models.ExtractedTable` objects
   in :attr:`~core.models.ParsedDocument.page_contents` and also appended as
   GFM markdown to the page text so the LLM extractor sees structured data.

DOCX files contain a native text layer — OCR is never needed, so
``PageContent.ocr_text`` is always an empty string.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import BinaryIO, Generator, List, Union

from docx import Document as _DocxDoc
from docx.table import Table as _Table
from docx.text.paragraph import Paragraph as _Paragraph

from core.exceptions import ParseError
from core.interfaces import IParser
from core.models import DocumentType, ExtractedTable, PageContent, ParsedDocument
from .pdf_parser import _build_document_id, _infer_document_type, _table_to_markdown

# Synthetic page size in characters (mirrors settings.max_chunk_chars)
PAGE_CHAR_LIMIT: int = 3_000


class DOCXParser(IParser):
    """Parse DOCX files into :class:`~core.models.ParsedDocument` objects."""

    def supports(self, filename: str) -> bool:
        return Path(filename).suffix.lower() == ".docx"

    def parse(self, file: BinaryIO, filename: str, progress_cb=None) -> ParsedDocument:
        """
        Extract text and tables from a DOCX file, grouped into synthetic pages.

        Parameters
        ----------
        file:
            Open binary stream of the DOCX, positioned at byte 0.
        filename:
            Original filename; used to derive the document type and ID.
        progress_cb:
            Optional callable; receives progress strings (unused for DOCX,
            included for interface parity with PDFParser).

        Returns
        -------
        ParsedDocument
            ``pages`` holds the best text per synthetic page (tables appended
            as GFM markdown).  ``page_contents`` carries structured per-page
            data (native text + extracted tables; ocr_text is always empty).

        Raises
        ------
        core.exceptions.ParseError
            Wraps any underlying :mod:`docx` or I/O error.
        """
        try:
            raw: bytes = file.read()
            docx_doc = _DocxDoc(io.BytesIO(raw))
        except Exception as exc:
            raise ParseError(f"Failed to open DOCX '{filename}': {exc}") from exc

        try:
            pages: List[str] = []
            page_contents: List[PageContent] = []

            # --- accumulator for the current synthetic page ---
            current_paras: List[str] = []
            current_len: int = 0
            current_tables: List[ExtractedTable] = []
            page_num: int = 1

            def _flush_page() -> None:
                """Commit the current accumulator as one synthetic page."""
                nonlocal current_paras, current_len, current_tables, page_num

                native_text = "\n".join(current_paras)
                full_text = native_text
                if current_tables:
                    tables_md = "\n\n".join(_table_to_markdown(t) for t in current_tables)
                    full_text = native_text + "\n\n[TABLES]\n" + tables_md

                if full_text.strip() or current_tables:
                    pages.append(full_text)
                    page_contents.append(PageContent(
                        page_num=page_num,
                        native_text=native_text,
                        ocr_text="",
                        tables=list(current_tables),
                    ))
                    page_num += 1

                current_paras = []
                current_len = 0
                current_tables = []

            for item in _iter_block_items(docx_doc):
                if isinstance(item, _Paragraph):
                    text = item.text.strip()
                    if not text:
                        continue
                    # Flush when char limit reached (but keep para on new page)
                    if current_len >= PAGE_CHAR_LIMIT and current_paras:
                        _flush_page()
                    current_paras.append(text)
                    current_len += len(text)

                elif isinstance(item, _Table):
                    table = _extract_docx_table(item, page_num)
                    if table is not None:
                        current_tables.append(table)

            # Flush any remaining content
            _flush_page()

            if not pages:
                pages = [""]
                page_contents = [PageContent(page_num=1, native_text="", ocr_text="", tables=[])]

            doc_type = _infer_document_type(filename)
            doc_id = _build_document_id(filename)

            return ParsedDocument(
                id=doc_id,
                name=filename,
                type=doc_type,
                pages=pages,
                total_pages=len(pages),
                page_contents=page_contents,
            )

        except ParseError:
            raise
        except Exception as exc:
            raise ParseError(f"Failed to parse DOCX '{filename}': {exc}") from exc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _iter_block_items(
    docx_doc: _DocxDoc,
) -> Generator[Union[_Paragraph, _Table], None, None]:
    """Yield top-level paragraphs and tables in document body order."""
    from docx.oxml.ns import qn

    p_tag = qn("w:p")
    t_tag = qn("w:tbl")

    for child in docx_doc.element.body.iterchildren():
        if child.tag == p_tag:
            yield _Paragraph(child, docx_doc)
        elif child.tag == t_tag:
            yield _Table(child, docx_doc)


def _extract_docx_table(tbl: _Table, page_num: int) -> "ExtractedTable | None":
    """Convert a python-docx :class:`~docx.table.Table` to an :class:`ExtractedTable`.

    Handles merged cells by deduplicating adjacent identical cell text within
    a row (a limitation of python-docx's ``row.cells`` for merged columns).
    """
    grid: List[List[str]] = []
    for row in tbl.rows:
        cells = [cell.text.strip() for cell in row.cells]
        # Deduplicate consecutive identical values that arise from merged cells
        deduped: List[str] = []
        for cell in cells:
            if not deduped or cell != deduped[-1]:
                deduped.append(cell)
        grid.append(deduped)

    if not grid:
        return None

    # Skip tables that are entirely empty
    all_text = [cell for row in grid for cell in row]
    if not any(all_text):
        return None

    # Normalize column count across rows to the widest row
    col_count = max(len(row) for row in grid)
    normalized = [row + [""] * (col_count - len(row)) for row in grid]

    return ExtractedTable(page=page_num, headers=normalized[0], rows=normalized[1:])
