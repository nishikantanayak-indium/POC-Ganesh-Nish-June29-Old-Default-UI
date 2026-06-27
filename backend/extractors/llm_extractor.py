import json
import re

from openai import OpenAI

from config.settings import settings
from core.models import ParsedDocument, AtomicElement, Relationship, ElementType, RelationshipType
from core.interfaces import IExtractor
from core.exceptions import ExtractionError


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

    def extract_elements(self, doc: ParsedDocument) -> list[AtomicElement]:
        full_text = "\n\n".join(doc.pages)
        chunks = self._chunk_text(full_text)
        raw_elements: list[dict] = []
        counters: dict[str, int] = {t: 0 for t in ["REQ", "CL", "RISK", "MIT", "LD"]}
        prefix_map: dict[str, str] = {
            "Requirement": "REQ",
            "Clause": "CL",
            "Risk": "RISK",
            "Mitigation": "MIT",
            "LD": "LD",
        }

        for i, chunk in enumerate(chunks):
            start_nums = {k: counters[k] + 1 for k in counters}
            system = (
                f"You are a procurement document analyst. Extract atomic semantic elements.\n"
                f"Document type: {doc.type.value} | Document: {doc.name}\n\n"
                f"Rules:\n"
                f"- Requirement: measurable obligation (SLA, deliverable, compliance) from RFP/RFX\n"
                f"- Clause: contractual term or obligation from contract/offer\n"
                f"- Risk: potential negative outcome or breach scenario\n"
                f"- Mitigation: action/mechanism to reduce a risk\n"
                f"- LD: Liquidated Damages — financial penalty clause\n"
                f"- ID format: REQ_001 (start from REQ_{start_nums['REQ']:03d}), "
                f"CL_{start_nums['CL']:03d}, RISK_{start_nums['RISK']:03d}, "
                f"MIT_{start_nums['MIT']:03d}, LD_{start_nums['LD']:03d}\n"
                f"- confidence: 0.9+ if explicitly stated, 0.7-0.9 if implied, skip below 0.7\n"
                f'- Source: "{doc.name} Page X" or "{doc.name} Section Y"'
            )

            try:
                resp = self.client.chat.completions.create(
                    model=settings.llm_model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": f"Extract elements from:\n\n{chunk}"},
                    ],
                    tools=[ELEMENT_TOOL],
                    tool_choice={"type": "function", "function": {"name": "extract_elements"}},
                    max_tokens=settings.max_tokens_extraction,
                )
                tc = resp.choices[0].message.tool_calls
                if tc:
                    data = json.loads(tc[0].function.arguments)
                    for e in data.get("elements", []):
                        if e.get("confidence", 0) >= settings.confidence_threshold:
                            raw_elements.append(e)
                            pfx = prefix_map.get(e["type"], "REQ")
                            counters[pfx] += 1
            except Exception as ex:
                raise ExtractionError(
                    f"Element extraction failed on chunk {i}: {ex}"
                ) from ex

        # Deduplicate: within same type, if word overlap > 70% keep higher confidence
        deduped: list[dict] = []
        for elem in raw_elements:
            words_e = set(elem["text"].lower().split())
            duplicate = False
            for kept in deduped:
                if kept["type"] == elem["type"]:
                    words_k = set(kept["text"].lower().split())
                    union = words_e | words_k
                    if union and len(words_e & words_k) / len(union) > 0.7:
                        if elem.get("confidence", 0) > kept.get("confidence", 0):
                            deduped.remove(kept)
                        else:
                            duplicate = True
                        break
            if not duplicate:
                deduped.append(elem)

        # Prefix IDs with a short doc slug so elements from different documents
        # never collide on MERGE in Neo4j (e.g. RFP_REQ_001 vs CON_REQ_001).
        raw_slug = re.sub(r"^DOC_", "", doc.id).upper()
        doc_slug = re.sub(r"[^A-Z0-9]", "", raw_slug)[:4] or "DOC"

        type_counters: dict[str, int] = {}
        result: list[AtomicElement] = []
        for e in deduped:
            pfx = prefix_map.get(e["type"], "REQ")
            type_counters[pfx] = type_counters.get(pfx, 0) + 1
            elem_id = f"{doc_slug}_{pfx}_{type_counters[pfx]:03d}"
            result.append(
                AtomicElement(
                    id=elem_id,
                    type=self._type_str_to_enum(e["type"]),
                    text=e["text"],
                    source=e.get("source", doc.name),
                    document_id=doc.id,
                    confidence=float(e.get("confidence", 1.0)),
                )
            )
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
