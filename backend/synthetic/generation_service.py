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
import uuid
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
