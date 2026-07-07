"""
Synthetic Data Generation Service.

Generates synthetic clauses, requirements, risks, mitigations, LDs, labeled
relationship/mapping examples, and whole composite documents (Contract / RFP /
Risk Sheet) via GPT-4o tool-calling, conditioned on real seed examples for
realism and on diversity knobs (industry / doc type / language).
"""
from __future__ import annotations

import json
import logging
import random
import uuid
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional

from openai import OpenAI

from config.settings import settings
from core.exceptions import ExtractionError
from core.models import AtomicElement, CoverageStatus, DocumentType, ElementType, RelationshipType

from .models import (
    RecordStatus,
    SyntheticDocument,
    SyntheticRecord,
    SyntheticRelationship,
)
from .schemas import REQUIRED_ATTRS
from . import taxonomy

logger = logging.getLogger(__name__)

_PREFIX = {
    ElementType.REQUIREMENT: "REQ", ElementType.CLAUSE: "CL", ElementType.RISK: "RISK",
    ElementType.MITIGATION: "MIT", ElementType.LD: "LD",
}


def _new_id(et: ElementType) -> str:
    return f"SYN_{_PREFIX[et]}_{uuid.uuid4().hex[:8].upper()}"


# ---------------------------------------------------------------------------
# OpenAI tool schemas
# ---------------------------------------------------------------------------

def _classify_tool(labels: List[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "classify",
            "description": "Assign the single best taxonomy label to each element.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string", "enum": labels},
                            },
                            "required": ["id", "label"],
                        },
                    }
                },
                "required": ["assignments"],
            },
        },
    }


def _suggest_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "suggest_labels",
            "description": "Propose a concise classification taxonomy derived from the content.",
            "parameters": {
                "type": "object",
                "properties": {"labels": {"type": "array", "items": {"type": "string"}}},
                "required": ["labels"],
            },
        },
    }


def _generate_tool(auto_label: bool, allowed_labels: List[str]) -> dict:
    item_props = {
        "text": {"type": "string"},
        "rationale": {"type": "string"},
        "industry": {"type": "string"},
        "doc_type": {"type": "string", "enum": [d.value for d in DocumentType]},
        "language": {"type": "string"},
        "risk_category": {"type": "string"},
        "clause_structure": {"type": "string"},
        "attributes": {"type": "object", "additionalProperties": True},
    }
    required = ["text", "rationale", "attributes"]
    if auto_label:
        # Describe mode: the model chooses the most fitting label per record.
        item_props["label"] = {"type": "string", "enum": allowed_labels}
        required.append("label")
    return {
        "type": "function",
        "function": {
            "name": "emit_records",
            "description": "Emit synthetic procurement records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "records": {"type": "array", "items": {
                        "type": "object", "properties": item_props, "required": required,
                    }}
                },
                "required": ["records"],
            },
        },
    }

def _generate_document_tool(with_key_facts: bool = False) -> dict:
    properties: dict = {
        "title": {"type": "string"},
        "industry": {"type": "string"},
        "language": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["heading", "body"],
            },
        },
    }
    if with_key_facts:
        # Concrete, extractable obligations (SLA %, response times, penalty
        # amounts, deadlines) — used to chain a linked deal's documents so
        # downstream documents can literally restate specific figures.
        properties["key_facts"] = {
            "type": "array",
            "description": (
                "3-8 concrete, specific obligations from this document (exact numbers, "
                "percentages, deadlines, monetary amounts) that a downstream document "
                "(e.g. a contract responding to this RFP, or a risk sheet analyzing this "
                "contract) would need to reference specifically."
            ),
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["id", "text"],
            },
        }
    return {
        "type": "function",
        "function": {
            "name": "emit_document",
            "description": "Emit one complete, coherent synthetic procurement document.",
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": ["title", "sections"],
            },
        },
    }


_VALIDATION_DIMENSION_DESCRIPTIONS = {
    "structural_fidelity": (
        "Does the document's section order/shape genuinely mirror the structural template it "
        "was given? 'aspect' = a specific source section or structural expectation being checked."
    ),
    "instruction_adherence": (
        "Was each requirement in the user's brief/note actually honoured in the document? "
        "'aspect' = one specific requirement extracted from the brief/note."
    ),
    "deal_consistency": (
        "Does this document genuinely restate the SAME specific figures/terms from the covered "
        "facts (not paraphrased away), AND correctly omit the held-back facts? 'aspect' = one "
        "specific fact — for a held-back fact, verdict='strong' means it was correctly and "
        "deliberately NOT mentioned, not that it was found."
    ),
    "realism": (
        "Does the document read as an authentic, internally consistent contract artifact with "
        "no contradictions or placeholder/generic filler? 'aspect' = one specific realism "
        "observation (e.g. a section that reads authentically, or one that doesn't)."
    ),
}


def _validate_document_tool(dimensions: List[str]) -> dict:
    evidence_item = {
        "type": "object",
        "properties": {
            "aspect": {"type": "string"},
            "quote": {
                "type": "string",
                "description": "A verbatim substring copied from the document text supporting this "
                                "judgment. Empty string if verdict is 'weak' and nothing supports it. "
                                "Never invent or paraphrase a quote — copy it exactly.",
            },
            "verdict": {"type": "string", "enum": ["strong", "partial", "weak"]},
        },
        "required": ["aspect", "verdict"],
    }
    dim_props = {}
    for dim in dimensions:
        dim_props[dim] = {
            "type": "object",
            "description": _VALIDATION_DIMENSION_DESCRIPTIONS[dim],
            "properties": {
                "score": {"type": "number", "minimum": 0, "maximum": 1},
                "summary": {"type": "string"},
                "evidence": {"type": "array", "items": evidence_item},
            },
            "required": ["score", "summary", "evidence"],
        }
    return {
        "type": "function",
        "function": {
            "name": "emit_validation",
            "description": (
                "Score the generated document against ONLY the requested validation dimensions, "
                "citing evidence quoted verbatim from the document text. Never score or fabricate "
                "evidence for a dimension that isn't listed below."
            ),
            "parameters": {
                "type": "object",
                "properties": dim_props,
                "required": list(dim_props.keys()),
            },
        },
    }


def _quote_appears_in(quote: str, text: str) -> bool:
    """Cheap, concrete anti-hallucination check — a cited quote must actually be a
    substring of the document, not just plausible-sounding. Normalizes whitespace
    so line-wrapping differences don't cause false negatives."""
    q = " ".join(quote.split()).strip().lower()
    if not q:
        return False
    return q in " ".join(text.split()).lower()


_ALL_VALIDATION_DIMENSIONS = ["structural_fidelity", "instruction_adherence", "deal_consistency", "realism"]


@dataclass
class DealContext:
    """Concrete facts carried forward from an earlier document in a linked
    deal set, so a downstream document can genuinely reference them —
    the real extractor links documents by semantic overlap of raw text,
    not shared IDs, so what matters is that the *wording* overlaps."""

    source_label: str  # e.g. "RFP" or "Contract" — what the facts came from
    covered_facts: List[str] = dc_field(default_factory=list)
    held_back_facts: List[str] = dc_field(default_factory=list)


# A conservative approximation of what comfortably fits in the prompt without
# crowding out the rest of the instructions — real pages run ~400-600 words.
STRUCTURE_HINT_FULL_TEXT_MAX_PAGES = 6


@dataclass
class StructureHint:
    """Grounds generation in a real uploaded document's structure, so the
    synthetic output isn't invented from nothing. For short documents we can
    afford to pass the full text as a template to mirror; for long documents
    we fall back to just the section heading order (already captured at
    upload time) to stay within the prompt budget."""

    source_name: str
    full_text: Optional[str] = None
    section_headings: Optional[List[str]] = None


_RELATE_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_relationships",
        "description": "Emit labeled relationship/mapping examples between the provided records.",
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
                            "rel_type": {
                                "type": "string",
                                "enum": [r.value for r in RelationshipType],
                            },
                            "coverage_label": {
                                "type": "string",
                                "enum": [c.value for c in CoverageStatus],
                            },
                            "is_positive": {"type": "boolean"},
                            "rationale": {"type": "string"},
                        },
                        "required": ["source_id", "target_id", "rel_type", "is_positive", "rationale"],
                    },
                }
            },
            "required": ["relationships"],
        },
    },
}


class SyntheticDataGenerationService:
    """Core #1 — generation."""

    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.llm_model

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _call(self, system: str, user: str, tool: dict, tool_name: str,
              max_tokens: int = 4000, temperature: float = 0.8) -> dict:
        try:
            resp = self.client.chat.completions.create(
                model=self.model, temperature=temperature,
                messages=[{"role": "system", "content": system},
                          {"role": "user", "content": user}],
                tools=[tool],
                tool_choice={"type": "function", "function": {"name": tool_name}},
                max_tokens=max_tokens,
            )
            tc = resp.choices[0].message.tool_calls
            if not tc:
                return {}
            return json.loads(tc[0].function.arguments)
        except Exception as exc:
            raise ExtractionError(f"Generation call '{tool_name}' failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Seed classification (for the gap-analysis overview)
    # ------------------------------------------------------------------

    def classify_elements(
        self, elements: List[AtomicElement], labels: Optional[List[str]] = None,
    ) -> Dict[str, str]:
        """Return {element_id: label} using the project's label set."""
        if not elements:
            return {}
        label_set = taxonomy.resolve_labels(labels)
        out: Dict[str, str] = {}
        desc = "\n".join(
            f"- {lbl}: {taxonomy.label_description(lbl) or '(project-defined category)'}"
            for lbl in label_set
        )
        tool = _classify_tool(label_set)
        for i in range(0, len(elements), 40):
            batch = elements[i:i + 40]
            listing = "\n".join(f"{e.id} [{e.type.value}]: {e.text[:200]}" for e in batch)
            system = (
                "You classify procurement elements into ONE label from this set.\n"
                f"Labels:\n{desc}\n"
                "Choose the single best-fitting label for each element."
            )
            data = self._call(system, f"Classify:\n{listing}", tool, "classify",
                              max_tokens=2000, temperature=0)
            for a in data.get("assignments", []):
                lbl = a.get("label")
                if lbl in label_set:
                    out[a["id"]] = lbl
        # Any element the model skipped defaults to a recommended (or first) label.
        for e in elements:
            if e.id not in out:
                rec = [l for l in taxonomy.RECOMMENDED_LABELS.get(e.type, []) if l in label_set]
                out[e.id] = rec[0] if rec else label_set[0]
        return out

    def suggest_labels(
        self, elements: List[AtomicElement], existing_labels: Optional[List[str]] = None,
        max_labels: int = 10,
    ) -> List[str]:
        """Propose a taxonomy of concise category labels derived from the seed
        content. Reuses fitting existing labels and adds new ones for uncovered
        themes — advisory only (the user adopts what they want)."""
        if not elements:
            return []
        existing = taxonomy.resolve_labels(existing_labels)
        sample = elements[:60]
        listing = "\n".join(f"- [{e.type.value}] {e.text[:160]}" for e in sample)
        system = (
            "You are designing a classification taxonomy for procurement / contract content.\n"
            f"Propose up to {max_labels} concise category labels (1-3 words each, Title Case) that best "
            "organize the elements below for downstream classification.\n"
            f"Reuse these existing labels where they fit: {existing}. "
            "Add new labels only for distinct themes not already covered. Return a deduplicated list."
        )
        try:
            data = self._call(system, f"Elements:\n{listing}", _suggest_tool(), "suggest_labels",
                              max_tokens=500, temperature=0.2)
        except Exception as exc:
            logger.warning("Label suggestion failed: %s", exc)
            return []
        out: List[str] = []
        for lbl in data.get("labels", []):
            s = str(lbl).strip()
            if s and s not in out:
                out.append(s)
        return out[:max_labels]

    # ------------------------------------------------------------------
    # Record generation
    # ------------------------------------------------------------------

    def generate_records(
        self,
        project_id: str,
        element_type: ElementType,
        count: int,
        label: Optional[str] = None,          # fixed label (Balance mode) or None → model assigns (Describe)
        allowed_labels: Optional[List[str]] = None,
        seeds: Optional[List[str]] = None,
        industries: Optional[List[str]] = None,
        languages: Optional[List[str]] = None,
        doc_types: Optional[List[DocumentType]] = None,
        version_id: Optional[str] = None,
        brief: Optional[str] = None,
    ) -> List[SyntheticRecord]:
        """Generate ``count`` records of ``element_type``.

        If ``label`` is given, all records carry it (Balance/matrix mode). If it
        is ``None``, the model assigns the most fitting label per record from
        ``allowed_labels`` (Describe mode)."""
        if count <= 0:
            return []
        industries = industries or taxonomy.DEFAULT_INDUSTRIES
        languages = languages or taxonomy.DEFAULT_LANGUAGES
        doc_types = doc_types or taxonomy.DEFAULT_DOC_TYPES
        label_set = taxonomy.resolve_labels(allowed_labels)
        auto_label = label is None
        et = element_type
        required_attrs = REQUIRED_ATTRS.get(et, [])

        seed_block = ""
        if seeds:
            seed_block = "\n\nReal reference examples (match their tone/structure, do NOT copy):\n" + \
                "\n".join(f"- {s[:240]}" for s in seeds[:8])
        brief_block = ""
        if brief and brief.strip():
            brief_block = f"\n\nUSER BRIEF — honour every requirement below in the generated text:\n{brief.strip()}"

        if auto_label:
            label_line = (
                f"For each record choose the single most fitting label from: {label_set}. "
                "Set the 'label' field accordingly."
            )
            target = f"{count} {et.value} records (assign each a label)"
        else:
            label_line = f"Taxonomy label: {label} — {taxonomy.label_description(label) or '(project-defined category)'}\nAll records are classified as {label}."
            target = f"{count} {et.value}/{label} records"

        system = (
            f"You are a senior procurement contract author generating realistic synthetic training data.\n"
            f"Element type: {et.value} — {taxonomy.ELEMENT_DESCRIPTIONS[et]}\n"
            f"{label_line}\n\n"
            f"Produce {count} DISTINCT, realistic {et.value} records.\n"
            f"Vary across industries {industries}, document types {[d.value for d in doc_types]}, "
            f"and languages {languages} to maximise diversity.\n"
            f"Each record MUST include these attribute keys in 'attributes': {required_attrs or '[]'}.\n"
            "Use authentic legal/contractual drafting conventions. Avoid near-duplicates.\n"
            "Set 'industry', 'doc_type', 'language' fields to reflect the variation you chose."
        )
        data = self._call(
            system, f"Generate {target}." + brief_block + seed_block,
            _generate_tool(auto_label, label_set), "emit_records",
            max_tokens=min(8000, 400 + count * 220), temperature=0.85,
        )
        records: List[SyntheticRecord] = []
        for raw in data.get("records", []):
            try:
                dtype = DocumentType(raw.get("doc_type", doc_types[0].value))
            except ValueError:
                dtype = doc_types[0]
            if auto_label:
                rlabel = raw.get("label") if raw.get("label") in label_set else label_set[0]
            else:
                rlabel = label
            rec = SyntheticRecord(
                id=_new_id(et), project_id=project_id, version_id=version_id,
                element_type=et, label=rlabel,
                text=str(raw.get("text", "")).strip(),
                rationale=str(raw.get("rationale", "")).strip(),
                industry=str(raw.get("industry") or industries[0]),
                doc_type=dtype,
                language=str(raw.get("language") or languages[0]),
                risk_category=raw.get("risk_category"),
                clause_structure=raw.get("clause_structure"),
                status=RecordStatus.CANDIDATE,
                attributes=raw.get("attributes") or {},
                provenance={
                    "model": self.model, "cell": f"{et.value}|{rlabel}",
                    "mode": "describe" if auto_label else "balance",
                    "seeds_used": len(seeds or []), "generator": "emit_records",
                },
            )
            records.append(rec)
        logger.info("Generated %d/%d %s records (auto_label=%s)", len(records), count, et.value, auto_label)
        return records

    # ------------------------------------------------------------------
    # Relationship / mapping generation
    # ------------------------------------------------------------------

    def generate_relationships(
        self, project_id: str, records: List[SyntheticRecord],
        version_id: Optional[str] = None, max_per_type: int = 8,
    ) -> List[SyntheticRelationship]:
        """Produce labeled mapping examples (incl. negatives) between records."""
        by_type: Dict[ElementType, List[SyntheticRecord]] = {}
        for r in records:
            by_type.setdefault(r.element_type, []).append(r)

        # Only attempt relationship families whose endpoints both exist.
        listing_parts: List[str] = []
        for et, recs in by_type.items():
            listing_parts.append(
                f"=== {et.value} ===\n" +
                "\n".join(f"{r.id}: {r.text[:160]}" for r in recs[:20])
            )
        if len(by_type) < 2:
            return []
        listing = "\n\n".join(listing_parts)

        id_to_type = {r.id: r.element_type for r in records}
        system = (
            "You label relationships between the provided procurement records to create "
            "balanced training data. Emit BOTH positive and negative examples.\n"
            "Allowed directed relationships:\n"
            "- COVERS / PARTIALLY_COVERS: Clause → Requirement (set coverage_label "
            "Covered / Partially Covered; for a NON-covering pair use is_positive=false and "
            "coverage_label 'Not Covered').\n"
            "- INTRODUCES_RISK: Requirement → Risk\n"
            "- MITIGATED_BY: Risk → Mitigation (is_positive=false when the mitigation is irrelevant)\n"
            "- LINKED_TO_LD: Risk or Requirement → LD\n"
            f"Produce up to {max_per_type} examples per relationship family. "
            "Only reference the ids listed. Give a one-line rationale each."
        )
        data = self._call(system, f"Records:\n{listing}", _RELATE_TOOL, "emit_relationships",
                          max_tokens=4000, temperature=0.6)
        out: List[SyntheticRelationship] = []
        for raw in data.get("relationships", []):
            sid, tid = raw.get("source_id"), raw.get("target_id")
            if sid not in id_to_type or tid not in id_to_type:
                continue
            try:
                rtype = RelationshipType(raw["rel_type"])
            except (KeyError, ValueError):
                continue
            cov = None
            if raw.get("coverage_label"):
                try:
                    cov = CoverageStatus(raw["coverage_label"])
                except ValueError:
                    cov = None
            out.append(SyntheticRelationship(
                id=f"SREL_{uuid.uuid4().hex[:8].upper()}", project_id=project_id,
                version_id=version_id, source_record_id=sid, target_record_id=tid,
                rel_type=rtype, coverage_label=cov, is_positive=bool(raw.get("is_positive", True)),
                rationale=str(raw.get("rationale", "")), status=RecordStatus.CANDIDATE,
                provenance={"model": self.model, "generator": "emit_relationships"},
            ))
        logger.info("Generated %d relationship examples", len(out))
        return out

    # ------------------------------------------------------------------
    # Composite document assembly
    # ------------------------------------------------------------------

    def assemble_document(
        self, project_id: str, records: List[SyntheticRecord],
        doc_type: DocumentType, version_id: Optional[str] = None,
        structure: Optional[List[Dict[str, Any]]] = None,
        brief: str = "",
    ) -> tuple[SyntheticDocument, str]:
        """
        Assemble member records into a coherent sectioned Markdown document.

        When ``structure`` (a mirrored source document's ordered
        ``[{heading, cells:{cell_key: n}}]``) is supplied, sections are laid out
        in the source's order and each section is filled with records whose cell
        matches that section — reproducing the source document's shape. Otherwise
        records are grouped by taxonomy label.
        """
        industry = records[0].industry if records else "General"
        title = (brief.strip()[:80] if brief.strip() else f"Synthetic {doc_type.value} — {industry}")
        lines = [f"# {title}", ""]
        if brief.strip():
            lines += [f"> Generated to brief: {brief.strip()}", ""]
        section_index: List[Dict[str, Any]] = []

        if structure:
            assembler = "mirrored-structure"
            pool: Dict[str, List[SyntheticRecord]] = {}
            for r in records:
                pool.setdefault(r.cell.key, []).append(r)
            used: set[str] = set()
            for sec in structure:
                heading = sec.get("heading", "Section")
                want_cells = sec.get("cells", {})
                lines.append(f"## {heading}")
                member_ids: List[str] = []
                idx = 1
                for cell_key, n in want_cells.items():
                    bucket = pool.get(cell_key, [])
                    for r in bucket[:n]:
                        if r.id in used:
                            continue
                        lines.append(f"{idx}. {r.text}")
                        member_ids.append(r.id); used.add(r.id); idx += 1
                    pool[cell_key] = bucket[n:]
                lines.append("")
                section_index.append({"heading": heading, "record_ids": member_ids})
            # Any records not placed by structure go under an appendix.
            leftover = [r for r in records if r.id not in used]
            if leftover:
                lines.append("## Additional Provisions")
                for i, r in enumerate(leftover, 1):
                    lines.append(f"{i}. {r.text}")
                lines.append("")
                section_index.append({"heading": "Additional Provisions", "record_ids": [r.id for r in leftover]})
        else:
            assembler = "label-grouped"
            grouped: Dict[str, List[SyntheticRecord]] = {}
            for r in records:
                grouped.setdefault(r.label, []).append(r)
            for label, recs in grouped.items():
                lines.append(f"## {label}")
                member_ids = []
                for i, r in enumerate(recs, 1):
                    lines.append(f"{i}. {r.text}")
                    member_ids.append(r.id)
                lines.append("")
                section_index.append({"heading": label, "record_ids": member_ids})

        markdown = "\n".join(lines)
        doc = SyntheticDocument(
            id=f"SDOC_{uuid.uuid4().hex[:8].upper()}", project_id=project_id, version_id=version_id,
            doc_type=doc_type, title=title,
            member_record_ids=[r.id for r in records], sections=section_index,
            status=RecordStatus.STAGED,
            provenance={"assembler": assembler, "record_count": len(records), "brief": bool(brief.strip())},
        )
        return doc, markdown

    # ------------------------------------------------------------------
    # Direct whole-document generation (document-level pivot)
    # ------------------------------------------------------------------

    def generate_document(
        self,
        project_id: str,
        doc_type: DocumentType,
        version_id: Optional[str] = None,
        seeds: Optional[List[str]] = None,
        industries: Optional[List[str]] = None,
        languages: Optional[List[str]] = None,
        brief: Optional[str] = None,
        note: Optional[str] = None,
        deal_context: Optional[DealContext] = None,
        structure_hint: Optional[StructureHint] = None,
        emit_key_facts: bool = False,
        min_sections: int = 4,
        max_sections: int = 9,
    ) -> tuple[SyntheticDocument, str, List[Dict[str, str]]]:
        """
        Author one complete, coherent synthetic document directly (no atomic
        elements as an intermediate step) — the document-level counterpart to
        ``generate_records`` + ``assemble_document`` combined into a single
        drafting call.

        ``deal_context``, when given, carries forward concrete facts from an
        earlier document in the same linked deal — this is what makes the
        real cross-document extractor (which links purely on semantic text
        overlap, no shared IDs needed) actually find relationships between
        independently-imported synthetic documents. ``emit_key_facts`` asks
        this document to itself emit facts for a downstream document to use.

        ``structure_hint``, when given, grounds the document's structure
        (section order, headings, level of detail) in a real uploaded
        document of the same type, instead of inventing structure from
        nothing every time.

        Returns ``(doc, markdown, key_facts)`` — ``key_facts`` is ``[]``
        unless ``emit_key_facts`` was requested.
        """
        industries = industries or taxonomy.DEFAULT_INDUSTRIES
        languages = languages or taxonomy.DEFAULT_LANGUAGES

        seed_block = ""
        if seeds:
            seed_block = "\n\nReal reference examples (match their tone/structure, do NOT copy):\n" + \
                "\n".join(f"- {s[:240]}" for s in seeds[:8])
        brief_block = ""
        if brief and brief.strip():
            brief_block = f"\n\nUSER BRIEF — honour every requirement below in the generated document:\n{brief.strip()}"
        note_block = ""
        if note and note.strip():
            note_block = f"\n\nADDITIONAL GUIDANCE — applies to this whole generation run:\n{note.strip()}"
        structure_block = ""
        if structure_hint is not None and structure_hint.full_text:
            structure_block = (
                f"\n\nSTRUCTURAL TEMPLATE — a real {doc_type.value} ('{structure_hint.source_name}') is given "
                "below in full. Mirror its structure closely: the same section order, the same level of "
                "detail and drafting style per section. Do NOT reuse any of its actual names, figures, or "
                "sentences — invent entirely new synthetic content that merely follows the same shape.\n\n"
                f"{structure_hint.full_text}"
            )
        elif structure_hint is not None and structure_hint.section_headings:
            headings = "\n".join(f"{i+1}. {h}" for i, h in enumerate(structure_hint.section_headings))
            structure_block = (
                f"\n\nSTRUCTURAL TEMPLATE — follow this real {doc_type.value}'s section order "
                f"('{structure_hint.source_name}'), inventing new synthetic content for each:\n{headings}"
            )
        deal_block = ""
        if deal_context is not None:
            covered = "\n".join(f"- {f}" for f in deal_context.covered_facts) or "(none)"
            held_back = "\n".join(f"- {f}" for f in deal_context.held_back_facts) or "(none)"
            deal_block = (
                f"\n\nDEAL CONTEXT — this document is part of the same deal as an earlier "
                f"{deal_context.source_label}. Reuse the SAME specific figures/terms/wording "
                f"(not paraphrased into vaguer language) for the facts below marked 'must reference'.\n"
                f"Facts to explicitly reference, restating the concrete figures:\n{covered}\n"
                f"Facts to deliberately NOT reference or address (realistic coverage gap — do not mention these):\n{held_back}"
            )

        key_facts_instruction = ""
        if emit_key_facts:
            key_facts_instruction = (
                "\nAlso emit 'key_facts': 3-8 concrete, specific obligations from this document "
                "(exact numbers, percentages, deadlines, monetary amounts) that a downstream "
                "document analyzing or responding to this one would need to reference specifically."
            )

        system = (
            f"You are a senior procurement contract author generating a realistic synthetic "
            f"{doc_type.value} document for training data.\n"
            f"Write ONE complete, internally consistent {doc_type.value} with {min_sections}-{max_sections} "
            f"sections covering the sections a real {doc_type.value} would contain end-to-end.\n"
            f"Vary industry (pick one from {industries}) and language (pick one from {languages}).\n"
            "Use authentic legal/contractual drafting conventions throughout — this must read as a whole "
            "document, not a list of disconnected clauses.\n"
            "Set 'industry' and 'language' to reflect what you chose."
            f"{key_facts_instruction}"
        )
        data = self._call(
            system,
            f"Generate one complete {doc_type.value} document."
            + brief_block + note_block + structure_block + deal_block + seed_block,
            _generate_document_tool(with_key_facts=emit_key_facts), "emit_document",
            max_tokens=6000, temperature=0.85,
        )
        title = str(data.get("title") or f"Synthetic {doc_type.value}").strip()
        industry = str(data.get("industry") or industries[0])
        language = str(data.get("language") or languages[0])
        sections = [
            {"heading": str(s.get("heading", "Section")), "body": str(s.get("body", "")).strip()}
            for s in data.get("sections", [])
            if str(s.get("body", "")).strip()
        ]
        key_facts = [
            {"id": str(f.get("id") or f"F{i+1}"), "text": str(f.get("text", "")).strip()}
            for i, f in enumerate(data.get("key_facts", []))
            if str(f.get("text", "")).strip()
        ] if emit_key_facts else []

        lines = [f"# {title}", ""]
        if brief and brief.strip():
            lines += [f"> Generated to brief: {brief.strip()}", ""]
        for sec in sections:
            lines.append(f"## {sec['heading']}")
            lines.append(sec["body"])
            lines.append("")
        markdown = "\n".join(lines)

        doc = SyntheticDocument(
            id=f"SDOC_{uuid.uuid4().hex[:8].upper()}", project_id=project_id, version_id=version_id,
            doc_type=doc_type, title=title,
            member_record_ids=[], sections=sections,
            status=RecordStatus.STAGED,
            provenance={
                "assembler": "direct-generation", "model": self.model,
                "industry": industry, "language": language,
                "brief": bool(brief and brief.strip()), "seeds_used": len(seeds or []),
                "synthetic": True,
                **({"deal_source": deal_context.source_label} if deal_context is not None else {}),
            },
        )
        logger.info("Generated document %s (%s, %d sections)", doc.id, doc_type.value, len(sections))
        return doc, markdown, key_facts

    # ------------------------------------------------------------------
    # Validation — evidence-backed LLM-as-judge, run right after generation
    # ------------------------------------------------------------------

    def validate_document(
        self,
        doc_type: DocumentType,
        markdown: str,
        brief: Optional[str] = None,
        note: Optional[str] = None,
        structure_hint: Optional[StructureHint] = None,
        deal_context: Optional[DealContext] = None,
    ) -> dict:
        """
        Score a just-generated document on whichever validation dimensions
        actually apply to it — never a dimension with nothing to check it
        against. Every score is backed by evidence quoted verbatim from the
        document; quotes that don't actually appear in the text (checked in
        Python, not just prompted for) are downgraded rather than trusted.
        """
        instructions_text = "\n".join(
            t.strip() for t in [brief, note] if t and t.strip()
        )
        dimensions: List[str] = ["realism"]
        if structure_hint is not None:
            dimensions.append("structural_fidelity")
        if instructions_text:
            dimensions.append("instruction_adherence")
        if deal_context is not None:
            dimensions.append("deal_consistency")

        reference_blocks: List[str] = []
        if "structural_fidelity" in dimensions:
            if structure_hint.full_text:
                reference_blocks.append(
                    f"STRUCTURAL TEMPLATE this document was asked to mirror ('{structure_hint.source_name}'), "
                    f"given in full:\n{structure_hint.full_text}"
                )
            elif structure_hint.section_headings:
                headings = "\n".join(f"{i+1}. {h}" for i, h in enumerate(structure_hint.section_headings))
                reference_blocks.append(
                    f"STRUCTURAL TEMPLATE this document was asked to mirror ('{structure_hint.source_name}')"
                    f" — section order only:\n{headings}"
                )
        if "instruction_adherence" in dimensions:
            reference_blocks.append(f"USER BRIEF/NOTE this document was asked to honour:\n{instructions_text}")
        if "deal_consistency" in dimensions:
            covered = "\n".join(f"- {f}" for f in deal_context.covered_facts) or "(none)"
            held_back = "\n".join(f"- {f}" for f in deal_context.held_back_facts) or "(none)"
            reference_blocks.append(
                f"DEAL FACTS from the earlier {deal_context.source_label} — this document should "
                f"explicitly restate the ones below marked 'covered' (matching figures, not vaguer "
                f"paraphrases) and correctly NOT mention the ones marked 'held back' "
                f"(a deliberate coverage gap):\nCovered facts:\n{covered}\nHeld-back facts:\n{held_back}"
            )

        system = (
            "You are an exacting QA reviewer for synthetic procurement documents. Score ONLY the "
            f"dimensions listed here: {dimensions}. For each, follow the scoring guidance and cite "
            "evidence quoted VERBATIM (copy-pasted, not paraphrased) from the document below. If "
            "nothing in the document supports a claim, use an empty quote and verdict='weak' — never "
            "invent a quote. Base every judgment strictly on the reference material and document "
            "actually provided; do not assume content that isn't given."
        )
        user = f"DOCUMENT ({doc_type.value}):\n{markdown}"
        if reference_blocks:
            user += "\n\n" + "\n\n".join(reference_blocks)

        result: Dict[str, dict] = {
            dim: {"applicable": dim in dimensions} for dim in _ALL_VALIDATION_DIMENSIONS
        }
        try:
            data = self._call(
                system, user, _validate_document_tool(dimensions), "emit_validation",
                max_tokens=3000, temperature=0,
            )
            scores: List[float] = []
            for dim in dimensions:
                raw = data.get(dim) or {}
                evidence = []
                for e in raw.get("evidence", []):
                    quote = str(e.get("quote", "")).strip()
                    verdict = e.get("verdict") if e.get("verdict") in ("strong", "partial", "weak") else "weak"
                    if quote and not _quote_appears_in(quote, markdown):
                        quote, verdict = "", "weak"
                    evidence.append({"aspect": str(e.get("aspect", "")).strip(), "quote": quote, "verdict": verdict})
                score = max(0.0, min(1.0, float(raw.get("score", 0.5))))
                scores.append(score)
                result[dim] = {
                    "applicable": True, "score": round(score, 3),
                    "summary": str(raw.get("summary", "")).strip(), "evidence": evidence,
                }
            overall = round(sum(scores) / len(scores), 3) if scores else None
            return {
                "model": self.model, "requested_dimensions": dimensions,
                "overall_score": overall, "dimensions": result, "error": None,
            }
        except Exception as exc:
            logger.warning("Document validation failed for %s: %s", doc_type.value, exc)
            return {
                "model": self.model, "requested_dimensions": dimensions,
                "overall_score": None,
                "dimensions": {dim: {"applicable": False} for dim in _ALL_VALIDATION_DIMENSIONS},
                "error": str(exc),
            }
