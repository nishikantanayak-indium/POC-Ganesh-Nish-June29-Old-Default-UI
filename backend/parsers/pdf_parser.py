"""
PDF document parser using PyMuPDF (fitz).

Implements :class:`core.interfaces.IParser` for `.pdf` files.

Two-pass extraction:
1. Native text via ``page.get_text()`` (fast, lossless for digital PDFs).
2. OCR fallback via Tesseract when a page yields < 20 characters — handles
   fully scanned PDFs like government RFPs that contain only image layers.

Table extraction:
- ``page.find_tables()`` is called on every page (PyMuPDF >= 1.23).
- Extracted tables are stored as :class:`~core.models.ExtractedTable` objects
  in :attr:`~core.models.ParsedDocument.page_contents`.
- A markdown rendering of each table is also appended to the page text so
  the LLM extractor sees structured data rather than fragmented cell text.

OCR quality filters:
- Pages where > 40 % of characters are non-ASCII are skipped (handles mixed
  Korean/CJK pages that tesseract renders as garbage).
- Pages where the OCR result is still < 20 chars after stripping are dropped.
"""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path
from typing import BinaryIO

import fitz  # PyMuPDF

from core.exceptions import ParseError
from core.interfaces import IParser
from core.models import DocumentType, ExtractedTable, PageContent, ParsedDocument

logger = logging.getLogger(__name__)

# Lazy-import OCR deps so the parser works even if they are absent (the
# native-text path still functions for digital PDFs).
_TESSERACT_AVAILABLE: bool | None = None  # None = not yet checked


def _check_tesseract() -> bool:
    global _TESSERACT_AVAILABLE
    if _TESSERACT_AVAILABLE is None:
        try:
            import pytesseract  # noqa: F401
            from PIL import Image  # noqa: F401
            _TESSERACT_AVAILABLE = True
        except ImportError:
            _TESSERACT_AVAILABLE = False
            logger.warning(
                "pytesseract / Pillow not installed — OCR fallback disabled. "
                "Install with: pip install pytesseract Pillow"
            )
    return _TESSERACT_AVAILABLE  # type: ignore[return-value]


def _non_ascii_ratio(text: str) -> float:
    if not text:
        return 0.0
    non_ascii = sum(1 for c in text if ord(c) > 127)
    return non_ascii / len(text)


def _render_page_image(page: fitz.Page, dpi: int = 150):
    """Render *page* to a PIL Image (RGB, suitable for both OCR and table detection)."""
    from PIL import Image
    scale = dpi / 72
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return Image.open(io.BytesIO(pix.tobytes("png")))


def _ocr_page(page: fitz.Page, dpi: int = 150) -> tuple[str, object]:
    """Render *page* and OCR it with Tesseract.

    Returns ``(text, pil_image)`` so callers can reuse the rendered image
    for table detection without re-rendering.
    """
    import pytesseract
    img = _render_page_image(page, dpi)
    text: str = pytesseract.image_to_string(img, config="--oem 3 --psm 6")
    return text, img


def _extract_scanned_tables(img, page_num: int) -> list[ExtractedTable]:
    """Extract tables from a raster page image using img2table + Tesseract.

    Used when the page is scanned (no PDF vector paths for the drawing-based
    extractor).  img2table detects table cell borders from pixel edges via
    OpenCV; Tesseract fills each cell with its OCR'd text.
    """
    try:
        from img2table.document import Image as Img2TableImage
        from img2table.ocr import TesseractOCR

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        doc = Img2TableImage(src=buf.getvalue())

        extracted = doc.extract_tables(
            ocr=TesseractOCR(),
            implicit_rows=True,
            borderless_tables=False,
        )
        if not extracted:
            return []

        tables: list[ExtractedTable] = []
        for tbl in extracted:
            if tbl.df.empty:
                continue
            df = tbl.df

            def _clean(v: object) -> str:
                s = str(v).strip()
                return "" if s in ("nan", "None") else s

            all_rows = [[_clean(cell) for cell in row] for row in df.values.tolist()]

            import re as _re
            _ref_pattern = _re.compile(r'^\d[\d.]*$')  # "1", "1.1", "2.3.4" etc.

            def _is_ref_cell(s: str) -> bool:
                """True when col-0 looks like a paragraph/section number."""
                return bool(_ref_pattern.match(s.strip()))

            # Merge consecutive rows into the previous row when col-0 is either
            # empty OR is a plain word (not a section-ref number).  This handles
            # two common scanned-table cases:
            #   • Multi-line data cells where the continuation row has no key
            #   • Header rows whose label wraps across two lines
            #     (e.g. "Paragraph" / "Reference" split by img2table)
            merged: list[list[str]] = []
            for row in all_rows:
                col0 = row[0] if row else ""
                is_continuation = (
                    merged
                    and any(row)
                    and not _is_ref_cell(col0)
                    and (not col0 or not _is_ref_cell(col0))
                    and (not col0 or len(col0.split()) <= 2)  # short word(s), not a sentence
                    and col0 == col0  # always true — guard against future changes
                )
                # Refine: only merge if col0 is empty OR is a short word continuation
                is_continuation = merged and any(row) and (
                    not col0  # empty col-0 → continuation
                    or (not _is_ref_cell(col0) and len(col0.split()) <= 2 and len(col0) < 20)
                )
                if is_continuation:
                    prev = merged[-1]
                    for ci in range(len(prev)):
                        extra = row[ci] if ci < len(row) else ""
                        if extra:
                            prev[ci] = (prev[ci] + " " + extra).strip()
                elif any(row):
                    merged.append(list(row))

            if len(merged) < 1:
                continue

            # First non-empty row is headers
            headers = merged[0]
            data_rows = merged[1:]

            all_text = headers + [c for row in data_rows for c in row]
            if any(t.strip() for t in all_text):
                tables.append(ExtractedTable(page=page_num, headers=headers, rows=data_rows))
        return tables
    except Exception:
        return []


def _get_vertical_lines(page: fitz.Page) -> list[tuple[float, float, float]]:
    """Return ``(x, y0, y1)`` for every vertical ruling line on the page.

    Deduplicates lines within 3 pt of each other (handles line borders drawn
    as thin filled rectangles with left-edge and right-edge very close).
    """
    raw: list[tuple[float, float, float]] = []
    for path in page.get_drawings():
        rect = fitz.Rect(path.get("rect", (0, 0, 0, 0)))
        w = rect.x1 - rect.x0
        h = rect.y1 - rect.y0
        if w < 3 and h > 15:           # thin, tall → vertical line
            mid_x = (rect.x0 + rect.x1) / 2
            raw.append((mid_x, rect.y0, rect.y1))

    # Sort by X and deduplicate within 3 pt
    raw.sort()
    deduped: list[tuple[float, float, float]] = []
    for x, y0, y1 in raw:
        if deduped and abs(x - deduped[-1][0]) < 3:
            # Extend the existing entry to cover the full Y span
            px, py0, py1 = deduped[-1]
            deduped[-1] = (px, min(py0, y0), max(py1, y1))
        else:
            deduped.append((x, y0, y1))
    return deduped


def _extract_text_in_rect(
    blocks: list[dict], rect: fitz.Rect
) -> str:
    """Return all text from *blocks* whose centre-line falls within *rect*."""
    lines: list[str] = []
    for block in blocks:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            bbox = line.get("bbox", (0, 0, 0, 0))
            line_x = bbox[0]
            line_y = (bbox[1] + bbox[3]) / 2
            if rect.x0 <= line_x <= rect.x1 and rect.y0 <= line_y <= rect.y1:
                parts = [
                    s.get("text", "").strip()
                    for s in line.get("spans", [])
                    if s.get("text", "").strip()
                ]
                if parts:
                    lines.append(" ".join(parts))
    return "\n".join(lines)


def _reconstruct_table_with_ruling_lines(
    page: fitz.Page,
    table_obj,                     # PyMuPDF Table object from find_tables()
    v_lines: list[tuple[float, float, float]],  # all page vertical lines
    page_num: int,
) -> "ExtractedTable | None":
    """Reconstruct a table using vertical ruling lines as column boundaries.

    ``find_tables()`` correctly detects ROW heights but can miss columns when
    a vertical divider only spans part of the table (e.g. a sub-box in the
    top row).  We override column detection with ALL vertical lines that
    overlap the table's Y range.
    """
    try:
        bbox = table_obj.bbox          # (x0, y0, x1, y1)
        cells_obj = table_obj.cells    # list[Rect | None], row-major
    except Exception:
        return None

    tab_y0, tab_y1 = bbox[1], bbox[3]

    # ── Column boundaries from vertical lines overlapping the table ────────
    # Include every vertical line whose Y span overlaps the table's Y range.
    col_xs = [
        x for x, vy0, vy1 in v_lines
        if vy0 < tab_y1 and vy1 > tab_y0
    ]
    if len(col_xs) < 2:
        return None

    col_xs = sorted(set(round(x, 1) for x in col_xs))

    # Column regions: between adjacent vertical lines
    col_regions = [(col_xs[i], col_xs[i + 1]) for i in range(len(col_xs) - 1)]

    # ── Row boundaries from detected cells (these are accurate) ───────────
    y_vals: set[float] = {round(tab_y0, 1), round(tab_y1, 1)}
    for cell_rect in cells_obj:
        if cell_rect is not None:
            r = fitz.Rect(cell_rect)
            y_vals.add(round(r.y0, 1))
            y_vals.add(round(r.y1, 1))
    row_bounds = sorted(y_vals)

    # ── Pre-fetch all text blocks for the page (one call, reused per cell) ─
    all_blocks: list[dict] = page.get_text("dict")["blocks"]

    # ── Build grid ─────────────────────────────────────────────────────────
    grid: list[list[str]] = []
    for i in range(len(row_bounds) - 1):
        y_top = row_bounds[i] - 1
        y_bot = row_bounds[i + 1] + 1

        row: list[str] = []
        for cx0, cx1 in col_regions:
            cell_rect = fitz.Rect(cx0 - 1, y_top, cx1 + 1, y_bot)
            cell_text = _extract_text_in_rect(all_blocks, cell_rect)
            row.append(cell_text)

        if any(row):
            grid.append(row)

    if not grid:
        return None

    return ExtractedTable(page=page_num, headers=grid[0], rows=grid[1:])


def _extract_page_tables(page: fitz.Page, page_num: int) -> list[ExtractedTable]:
    """Extract structured tables from *page*.

    Strategy (in order):
    1. Use ``find_tables()`` to locate table areas and row structure.
    2. Use PDF drawing paths (vertical ruling lines) to determine the TRUE
       column boundaries — ``find_tables()`` sometimes misses a column when
       its divider line only spans part of the table height (e.g. a sub-box
       nested in one row).  Ruling-line detection gives exact column regions.
    3. Extract cell text by querying each [col_x0..col_x1] × [row_y0..row_y1]
       rectangle, which properly handles multi-line cells.

    Falls back to the simpler ``extract()`` approach for tables that have no
    detectable ruling lines (text-based tables, e.g. from DOCX-converted PDFs).
    """
    tables: list[ExtractedTable] = []
    try:
        tab_finder = page.find_tables()
        if not tab_finder.tables:
            return tables

        v_lines = _get_vertical_lines(page)

        for t in tab_finder.tables:
            # Prefer ruling-line reconstruction when lines are available
            table = _reconstruct_table_with_ruling_lines(page, t, v_lines, page_num)

            if table is None:
                # Fallback: use find_tables()'s own cell extraction
                cells = t.extract()
                if not cells:
                    continue
                headers = [str(c or "").strip() for c in cells[0]]
                rows = [[str(c or "").strip() for c in row] for row in cells[1:]]
                all_cells = headers + [cell for row in rows for cell in row]
                if any(all_cells):
                    table = ExtractedTable(page=page_num, headers=headers, rows=rows)

            if table is not None:
                # Skip tables that are entirely empty
                all_text = table.headers + [c for row in table.rows for c in row]
                if any(all_text):
                    tables.append(table)

    except Exception:
        pass
    return tables


def _table_to_markdown(table: ExtractedTable) -> str:
    """Convert *table* to a GitHub-flavoured Markdown table string."""
    if not table.headers:
        return ""
    lines: list[str] = []
    lines.append("| " + " | ".join(table.headers or ["Col1"]) + " |")
    lines.append("| " + " | ".join("---" for _ in table.headers) + " |")
    for row in table.rows:
        padded = list(row) + [""] * max(0, len(table.headers) - len(row))
        lines.append("| " + " | ".join(padded[: len(table.headers)]) + " |")
    return "\n".join(lines)


class PDFParser(IParser):
    """Parse PDF files into :class:`~core.models.ParsedDocument` objects.

    Parameters
    ----------
    ocr_dpi:
        Resolution used when rendering scanned pages for OCR (default 150 DPI).
        Higher values improve accuracy at the cost of speed.
    non_ascii_threshold:
        Pages where the fraction of non-ASCII characters exceeds this value
        are discarded (catches CJK / garbled OCR output).  Default 0.40.
    """

    def __init__(
        self,
        ocr_dpi: int = 150,
        non_ascii_threshold: float = 0.40,
    ) -> None:
        self.ocr_dpi = ocr_dpi
        self.non_ascii_threshold = non_ascii_threshold

    # ------------------------------------------------------------------
    # IParser contract
    # ------------------------------------------------------------------

    def supports(self, filename: str) -> bool:
        return Path(filename).suffix.lower() == ".pdf"

    def parse(
        self,
        file: BinaryIO,
        filename: str,
        progress_cb=None,
    ) -> ParsedDocument:
        """Extract text and tables from every page, falling back to OCR for
        scanned pages.

        Parameters
        ----------
        file:
            Open binary stream of the PDF, positioned at byte 0.
        filename:
            Original filename; used to derive the document type and ID.
        progress_cb:
            Optional callable that receives progress strings for real-time
            streaming to the UI (e.g. OCR page progress).

        Returns
        -------
        ParsedDocument
            One entry in ``pages`` per page that yields usable text.
            ``page_contents`` carries native text, OCR text, and any
            extracted tables for each corresponding page.

        Raises
        ------
        core.exceptions.ParseError
            Wraps any underlying :mod:`fitz` or I/O error.
        """
        try:
            data: bytes = file.read()
            pdf_doc = fitz.open(stream=data, filetype="pdf")
        except Exception as exc:
            raise ParseError(f"Failed to open PDF '{filename}': {exc}") from exc

        ocr_available = _check_tesseract()
        total_pages = pdf_doc.page_count
        pages: list[str] = []
        page_contents: list[PageContent] = []
        ocr_count = 0
        skipped_count = 0

        if progress_cb:
            mode = "OCR" if ocr_available else "text"
            progress_cb(f"  Scanning {total_pages} pages ({mode})…")

        for page_num, page in enumerate(pdf_doc, start=1):
            # ── Pass 1: native text ────────────────────────────────────
            native_text: str = page.get_text("text").strip()

            # ── Pass 2: OCR fallback for image-only pages ──────────────
            ocr_text: str = ""
            page_image = None  # rendered PIL image, reused for scanned table extraction
            is_scanned = len(native_text) < 20

            if is_scanned:
                if not ocr_available:
                    continue  # can't OCR, skip blank page
                try:
                    if progress_cb:
                        progress_cb(f"  OCR page {page_num}/{total_pages}…")
                    ocr_text, page_image = _ocr_page(page, dpi=self.ocr_dpi)
                    ocr_text = ocr_text.strip()
                    ocr_count += 1
                except Exception as exc:
                    logger.warning(
                        "OCR failed for page %d of '%s': %s", page_num, filename, exc
                    )
                    continue

            # ── Table extraction ───────────────────────────────────────
            # Digital pages: use PDF vector paths (fast, accurate).
            # Scanned pages: use pixel-based border detection via img2table.
            if is_scanned and page_image is not None:
                page_tables = _extract_scanned_tables(page_image, page_num)
            else:
                page_tables = _extract_page_tables(page, page_num)

            # Best available text for quality filtering
            best_text = ocr_text if ocr_text else native_text

            # ── Quality filters ────────────────────────────────────────
            if len(best_text) < 20:
                skipped_count += 1
                continue

            if _non_ascii_ratio(best_text) > self.non_ascii_threshold:
                logger.debug(
                    "Skipping page %d of '%s' (high non-ASCII ratio — likely CJK/form)",
                    page_num,
                    filename,
                )
                skipped_count += 1
                continue

            # ── Enrich text with structured table markdown ─────────────
            # Appending markdown tables gives the LLM a structured view of
            # tabular data that page.get_text() renders as fragmented cells.
            full_text = best_text
            if page_tables:
                tables_md = "\n\n".join(_table_to_markdown(t) for t in page_tables)
                full_text = best_text + "\n\n[TABLES]\n" + tables_md

            pages.append(full_text)
            page_contents.append(PageContent(
                page_num=page_num,
                native_text=native_text,
                ocr_text=ocr_text,
                tables=page_tables,
            ))

        if ocr_count:
            logger.info(
                "Parsed '%s': %d pages (%d via OCR, %d skipped)",
                filename, len(pages), ocr_count, skipped_count,
            )
            if progress_cb:
                progress_cb(
                    f"  OCR complete — {len(pages)} usable pages "
                    f"({ocr_count} OCR'd, {skipped_count} skipped)"
                )
        else:
            logger.info(
                "Parsed '%s': %d pages (%d skipped)",
                filename, len(pages), skipped_count,
            )

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


# ---------------------------------------------------------------------------
# Shared helpers (used by docx_parser as well via import)
# ---------------------------------------------------------------------------

def _infer_document_type(filename: str) -> DocumentType:
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
    stem = Path(filename).stem.lower()
    stem = re.sub(r"[\s\-]+", "_", stem)
    stem = re.sub(r"[^a-z0-9_]", "", stem)
    return "DOC_" + stem
