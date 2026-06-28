"""
PDF document parser using PyMuPDF (fitz).

Implements :class:`core.interfaces.IParser` for `.pdf` files.

Two-pass extraction:
1. Native text via ``page.get_text()`` (fast, lossless for digital PDFs).
2. OCR fallback via Tesseract when a page yields < 20 characters — handles
   fully scanned PDFs like government RFPs that contain only image layers.

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
from core.models import DocumentType, ParsedDocument

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


def _ocr_page(page: fitz.Page, dpi: int = 150) -> str:
    """Render *page* to a grayscale image and OCR it with Tesseract.

    Grayscale at 150 DPI uses ~6× less memory than RGB at 200 DPI while
    keeping text quality sufficient for standard RFP/contract documents.
    """
    import pytesseract
    from PIL import Image

    scale = dpi / 72
    mat = fitz.Matrix(scale, scale)
    # Grayscale pixmap: 1 byte per pixel vs 3 for RGB — faster and lighter
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    text: str = pytesseract.image_to_string(img, config="--oem 3 --psm 6")
    return text


class PDFParser(IParser):
    """Parse PDF files into :class:`~core.models.ParsedDocument` objects.

    Parameters
    ----------
    ocr_dpi:
        Resolution used when rendering scanned pages for OCR (default 200 DPI).
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
        """Extract text from every page, falling back to OCR for scanned pages.

        Parameters
        ----------
        file:
            Open binary stream of the PDF, positioned at byte 0.
        filename:
            Original filename; used to derive the document type and ID.

        Returns
        -------
        ParsedDocument
            One entry in ``pages`` per page that yields usable text.

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
        ocr_count = 0
        skipped_count = 0

        if progress_cb:
            mode = "OCR" if ocr_available else "text"
            progress_cb(f"  Scanning {total_pages} pages ({mode})…")

        for page_num, page in enumerate(pdf_doc, start=1):
            # ── Pass 1: native text ────────────────────────────────────
            text: str = page.get_text("text")

            # ── Pass 2: OCR fallback for image-only pages ──────────────
            if len(text.strip()) < 20:
                if not ocr_available:
                    continue  # can't OCR, skip blank page
                try:
                    if progress_cb:
                        progress_cb(f"  OCR page {page_num}/{total_pages}…")
                    text = _ocr_page(page, dpi=self.ocr_dpi)
                    ocr_count += 1
                except Exception as exc:
                    logger.warning(
                        "OCR failed for page %d of '%s': %s", page_num, filename, exc
                    )
                    continue

            # ── Quality filters ────────────────────────────────────────
            stripped = text.strip()
            if len(stripped) < 20:
                skipped_count += 1
                continue

            if _non_ascii_ratio(stripped) > self.non_ascii_threshold:
                logger.debug(
                    "Skipping page %d of '%s' (high non-ASCII ratio — likely CJK/form)",
                    page_num,
                    filename,
                )
                skipped_count += 1
                continue

            pages.append(stripped)

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
