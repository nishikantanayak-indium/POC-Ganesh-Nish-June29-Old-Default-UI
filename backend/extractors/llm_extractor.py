import json
import logging
import re
from typing import Callable

from openai import OpenAI

from config.settings import settings
from core.models import ParsedDocument, AtomicElement, Relationship, ElementType, RelationshipType
from core.interfaces import IExtractor
from core.exceptions import ExtractionError

logger = logging.getLogger(__name__)


ELEMENT_TOOL = {
    "type": "function",
    "function": {
        "name": "extract_elements",
        "description": "Extract typed atomic procurement elements",
        "parameters": {
            "type": "object",
            "properties": {
                "elements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "type": {
                                "type": "string",
                                "enum": ["Requirement", "Clause", "Risk", "Mitigation", "LD"],
                            },
                            "text": {"type": "string"},
                            "source": {"type": "string"},
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        },
                        "required": ["id", "type", "text", "source", "confidence"],
                    },
                }
            },
            "required": ["elements"],
        },
    },
}

RELATIONSHIP_TOOL = {
    "type": "function",
    "function": {
        "name": "create_relationships",
        "description": "Infer relationships between elements",
        "parameters": {
            "type": "object",
            "properties": {
                "relationships": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_id": {"type": "string"},
                            "target_id": {"type": "string"},
                            "type": {
                                "type": "string",
                                "enum": [
                                    "COVERS",
                                    "PARTIALLY_COVERS",
                                    "INTRODUCES_RISK",
                                    "MITIGATED_BY",
                                    "LINKED_TO_LD",
                                    "CONTRADICTS",
                                ],
                            },
                            "confidence": {"type": "number"},
                            "evidence": {"type": "string"},
                        },
                        "required": ["source_id", "target_id", "type", "confidence", "evidence"],
                    },
                }
            },
            "required": ["relationships"],
        },
    },
}


class LLMExtractor(IExtractor):
    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _chunk_text(self, full_text: str) -> list[str]:
        chunk_size = settings.max_chunk_chars
        overlap = settings.chunk_overlap_chars
        sentences = re.split(r"(?<=[.!?])\s+", full_text)
        chunks: list[str] = []
        current: list[str] = []
        current_len: int = 0

        for sent in sentences:
            if current_len + len(sent) > chunk_size and current:
                chunks.append(" ".join(current))
                # keep overlap: pop sentences from front until under overlap
                while current and current_len - len(current[0]) > overlap:
                    current_len -= len(current.pop(0)) + 1
            current.append(sent)
            current_len += len(sent) + 1

        if current:
            chunks.append(" ".join(current))

        return [c for c in chunks if len(c.strip()) > 50]

    _SECTION_RE = re.compile(
        r'(?:^|\n)(?:'
        r'Section\s+\d+[\.\:]?\s+\w'           # Section 1. Letter
        r'|(?:\d+\.){1,3}\s*\w'                # 3.1.2 Background
        r'|(?:APPENDIX|ANNEX)\s+[A-Z"\']+'     # APPENDIX A / ANNEX "B"
        r'|(?:GCC|SCC)\s+\d+\.\d+'             # GCC 6.1
        r'|[IVX]+\.\s+[A-Z][A-Z]'              # IV. APPENDICES
        r')',
        re.IGNORECASE | re.MULTILINE,
    )

    def _detect_section(self, page_text: str) -> str | None:
        """Scan the first 5 lines of a page for a section header.

        Returns the full matched line (not just the regex match) so labels
        like 'Section 5. Terms of Reference' are preserved intact.
        """
        lines = page_text.splitlines()[:5]
        for line in lines:
            if self._SECTION_RE.search(line):
                label = line.strip()
                # Truncate very long labels (e.g. inline paragraph text mistaken for header)
                return label[:80] if len(label) > 80 else label
        return None

    def _split_text_into_chunks(
        self, text: str
    ) -> list[str]:
        """Split *text* into overlapping sentence-boundary chunks."""
        chunk_size = settings.max_chunk_chars
        overlap = settings.chunk_overlap_chars
        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks: list[str] = []
        current: list[str] = []
        current_len: int = 0

        for sent in sentences:
            if current_len + len(sent) > chunk_size and current:
                chunks.append(" ".join(current))
                while current and current_len - len(current[0]) > overlap:
                    current_len -= len(current.pop(0)) + 1
            current.append(sent)
            current_len += len(sent) + 1

        if current:
            chunks.append(" ".join(current))

        return chunks

    def _chunk_pages(
        self, pages: list[str]
    ) -> list[tuple[str, str, int]]:
        """
        Chunk a list of pages into (section_label, chunk_text, start_page_1indexed) tuples.

        Section headers are detected from the first 5 lines of each page.
        The last known section label is carried forward to pages with no header.
        Chunks shorter than 80 chars of actual content are discarded.
        Every chunk is prefixed with ``[{section_label} | Page {start_page}]``
        so the LLM has structural context.
        """
        # Group pages by section
        current_section = "General"
        # Each group: (section_label, start_page_1indexed, accumulated_text)
        groups: list[tuple[str, int, str]] = []

        for page_idx, page_text in enumerate(pages):
            page_num = page_idx + 1  # 1-indexed
            detected = self._detect_section(page_text)
            if detected:
                current_section = detected
            # Start a new group when section changes or on first page
            if not groups or groups[-1][0] != current_section:
                groups.append((current_section, page_num, page_text))
            else:
                # Append to existing group's text
                label, start, accumulated = groups[-1]
                groups[-1] = (label, start, accumulated + "\n\n" + page_text)

        # Now split each group into sized chunks
        result: list[tuple[str, str, int]] = []
        for section_label, start_page, section_text in groups:
            raw_chunks = self._split_text_into_chunks(section_text)
            for raw_chunk in raw_chunks:
                # Filter out chunks with < 80 chars of actual content
                if len(raw_chunk.strip()) < 80:
                    continue
                prefix = f"[{section_label} | Page {start_page}]\n"
                chunk_text = prefix + raw_chunk
                result.append((section_label, chunk_text, start_page))

        return result

    def _type_str_to_enum(self, t: str) -> ElementType:
        mapping: dict[str, ElementType] = {
            "Requirement": ElementType.REQUIREMENT,
            "Clause": ElementType.CLAUSE,
            "Risk": ElementType.RISK,
            "Mitigation": ElementType.MITIGATION,
            "LD": ElementType.LD,
        }
        return mapping.get(t, ElementType.REQUIREMENT)

    def _rel_str_to_enum(self, t: str) -> RelationshipType | None:
        try:
            return RelationshipType(t)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # IExtractor interface
    # ------------------------------------------------------------------

    def extract_elements(
        self,
        doc: ParsedDocument,
        progress_cb: Callable[[str], None] | None = None,
    ) -> list[AtomicElement]:
        chunks = self._chunk_pages(doc.pages)
        raw_elements: list[dict] = []
        chunk_meta: list[tuple[str, int]] = []
        counters: dict[str, int] = {t: 0 for t in ["REQ", "CL", "RISK", "MIT", "LD"]}
        prefix_map: dict[str, str] = {
            "Requirement": "REQ",
            "Clause": "CL",
            "Risk": "RISK",
            "Mitigation": "MIT",
            "LD": "LD",
        }

        if progress_cb:
            progress_cb(f"  {len(chunks)} section-chunk(s) to process via {settings.llm_model}")

        for i, (section_label, chunk_text, start_page) in enumerate(chunks):
            if progress_cb:
                progress_cb(
                    f"  LLM [{i + 1}/{len(chunks)}] {section_label[:50]} (p.{start_page})"
                    f" — {len(chunk_text)} chars"
                )

            source_hint = f"{doc.name} — {section_label}"
            start_nums = {k: counters[k] + 1 for k in counters}
            system = (
                f"You are a procurement document analyst. Extract atomic semantic elements.\n"
                f"Document type: {doc.type.value} | Document: {doc.name}\n\n"
                f"Element types:\n"
                f"- Requirement: any measurable obligation the contractor/consultant MUST fulfil — "
                f"deliverables with deadlines, hard copies/electronic copies, reporting frequency, "
                f"personnel qualifications, SLA targets, compliance mandates. Common in RFP/TOR.\n"
                f"- Clause: contractual term from a contract/agreement — payment schedules, "
                f"advance payments, termination rights, arbitration, warranty periods, liability caps.\n"
                f"- Risk: explicit potential negative outcome or breach scenario.\n"
                f"- Mitigation: action or mechanism that reduces a specific risk.\n"
                f"- LD: Liquidated Damages or financial penalty tied to non-performance.\n\n"
                f"Extraction rules:\n"
                f"- Extract EVERY distinct obligation, deadline, or deliverable as its own element.\n"
                f"- For scanned/OCR'd text: interpret imperfectly formatted lines (OCR artefacts) — "
                f"focus on the semantic meaning, not the exact formatting.\n"
                f"- Ignore pure table headers, form template labels, and blank-fill instructions.\n"
                f"- ID format: REQ_{start_nums['REQ']:03d}…, "
                f"CL_{start_nums['CL']:03d}…, RISK_{start_nums['RISK']:03d}…, "
                f"MIT_{start_nums['MIT']:03d}…, LD_{start_nums['LD']:03d}…\n"
                f"- confidence: 0.9+ if explicitly stated, 0.7–0.9 if implied, skip below 0.7\n"
                f'- Source: use "{source_hint}" verbatim as the source field'
            )

            try:
                resp = self.client.chat.completions.create(
                    model=settings.llm_model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": f"Extract elements from:\n\n{chunk_text}"},
                    ],
                    tools=[ELEMENT_TOOL],
                    tool_choice={"type": "function", "function": {"name": "extract_elements"}},
                    max_tokens=settings.max_tokens_extraction,
                )
                tc = resp.choices[0].message.tool_calls
                n_found = 0
                if tc:
                    data = json.loads(tc[0].function.arguments)
                    for e in data.get("elements", []):
                        if e.get("confidence", 0) >= settings.confidence_threshold:
                            raw_elements.append(e)
                            chunk_meta.append((section_label, start_page))
                            pfx = prefix_map.get(e["type"], "REQ")
                            counters[pfx] += 1
                            n_found += 1
                if progress_cb:
                    usage = resp.usage
                    tok_info = (
                        f" ({usage.prompt_tokens}+{usage.completion_tokens} tok)"
                        if usage else ""
                    )
                    progress_cb(
                        f"  ✓ [{i + 1}/{len(chunks)}] {n_found} element(s) above threshold{tok_info}"
                    )
            except Exception as ex:
                if progress_cb:
                    progress_cb(f"  ✗ [{i + 1}/{len(chunks)}] extraction failed: {ex}")
                raise ExtractionError(
                    f"Element extraction failed on chunk {i}: {ex}"
                ) from ex

        # Deduplicate: within same type, if word overlap > 70% keep higher confidence
        deduped: list[dict] = []
        deduped_meta: list[tuple[str, int]] = []
        for idx, elem in enumerate(raw_elements):
            words_e = set(elem["text"].lower().split())
            duplicate = False
            for j, kept in enumerate(deduped):
                if kept["type"] == elem["type"]:
                    words_k = set(kept["text"].lower().split())
                    union = words_e | words_k
                    if union and len(words_e & words_k) / len(union) > 0.7:
                        if elem.get("confidence", 0) > kept.get("confidence", 0):
                            deduped[j] = elem
                            deduped_meta[j] = chunk_meta[idx]
                        else:
                            duplicate = True
                        break
            if not duplicate:
                deduped.append(elem)
                deduped_meta.append(chunk_meta[idx])

        if progress_cb and len(raw_elements) != len(deduped):
            progress_cb(
                f"  Dedup: {len(raw_elements)} raw → {len(deduped)} unique elements"
            )

        # Prefix IDs with a short doc slug so elements from different documents
        # never collide on MERGE in Neo4j (e.g. RFP_REQ_001 vs CON_REQ_001).
        raw_slug = re.sub(r"^DOC_", "", doc.id).upper()
        doc_slug = re.sub(r"[^A-Z0-9]", "", raw_slug)[:4] or "DOC"

        type_counters: dict[str, int] = {}
        result: list[AtomicElement] = []
        for e, (section_label, page_number) in zip(deduped, deduped_meta):
            pfx = prefix_map.get(e["type"], "REQ")
            type_counters[pfx] = type_counters.get(pfx, 0) + 1
            elem_id = f"{doc_slug}_{pfx}_{type_counters[pfx]:03d}"
            atomic = AtomicElement(
                id=elem_id,
                type=self._type_str_to_enum(e["type"]),
                text=e["text"],
                source=e.get("source", doc.name),
                document_id=doc.id,
                confidence=float(e.get("confidence", 1.0)),
            )
            atomic.metadata["section"] = section_label
            atomic.metadata["page_number"] = page_number
            result.append(atomic)
        return result

    def extract_relationships(self, elements: list[AtomicElement]) -> list[Relationship]:
        if not elements:
            return []

        elem_ids = {e.id for e in elements}
        elem_list = "\n".join(
            f"{e.id} | {e.type.value} | {e.text[:120]} ({e.source})" for e in elements
        )
        system = (
            "You are a procurement knowledge graph analyst. Infer relationships between elements.\n\n"
            "Relationship types:\n"
            "- COVERS: Contract Clause fully addresses an RFP Requirement (same topic, same/better SLA)\n"
            "- PARTIALLY_COVERS: Clause addresses topic but with lower SLA or missing aspects\n"
            "- INTRODUCES_RISK: Requirement creates this Risk if breached or not met\n"
            "- MITIGATED_BY: Risk is addressed/reduced by this Mitigation\n"
            "- LINKED_TO_LD: Risk or Requirement has this LD as financial consequence\n"
            "- CONTRADICTS: Two Clauses directly conflict\n\n"
            "Rules: only confidence >= 0.6. Both IDs must exist in the provided list."
        )

        try:
            resp = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": f"Infer relationships for:\n\n{elem_list}"},
                ],
                tools=[RELATIONSHIP_TOOL],
                tool_choice={"type": "function", "function": {"name": "create_relationships"}},
                max_tokens=4000,
            )
            tc = resp.choices[0].message.tool_calls
            if not tc:
                return []

            data = json.loads(tc[0].function.arguments)
            rels: list[Relationship] = []
            for r in data.get("relationships", []):
                if r["source_id"] not in elem_ids or r["target_id"] not in elem_ids:
                    continue
                if float(r.get("confidence", 0)) < settings.confidence_threshold:
                    continue
                rel_type = self._rel_str_to_enum(r["type"])
                if rel_type is None:
                    continue
                rels.append(
                    Relationship(
                        source_id=r["source_id"],
                        target_id=r["target_id"],
                        type=rel_type,
                        confidence=float(r["confidence"]),
                        evidence=r.get("evidence", ""),
                    )
                )
            return rels
        except Exception as ex:
            raise ExtractionError(f"Relationship extraction failed: {ex}") from ex
