"""
Synthetic Data Validation Service.

Three gates per the spec:
  * Schema Validity   — Pydantic / JSON Schema structural check.
  * Label Validity    — label ∈ approved taxonomy and a valid matrix cell.
  * Business rules /
    Coverage Consistency — direction + label rules on relationship examples.

Records failing validation are marked REJECTED by the caller (dataset service)
and fed back to the regeneration loop.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from core.models import ElementType

from .models import SyntheticRecord, SyntheticRelationship, ValidationReport
from .schemas import validate_record_payload
from . import taxonomy

logger = logging.getLogger(__name__)


class SyntheticDataValidationService:
    """Core #2 — validation."""

    def _record_payload(self, rec: SyntheticRecord) -> dict:
        return {
            "element_type": rec.element_type.value,
            "label": rec.label.value,
            "text": rec.text,
            "rationale": rec.rationale,
            "industry": rec.industry,
            "doc_type": rec.doc_type.value,
            "language": rec.language,
            "risk_category": rec.risk_category,
            "clause_structure": rec.clause_structure,
            "attributes": rec.attributes,
        }

    def validate_record(self, rec: SyntheticRecord) -> ValidationReport:
        reasons: List[str] = []

        # 1 · Schema Validity
        schema_ok, schema_errs = validate_record_payload(self._record_payload(rec))
        reasons += [f"schema: {e}" for e in schema_errs]

        # 2 · Label Validity
        label_ok = taxonomy.is_valid_label(rec.label.value) and taxonomy.is_valid_cell(rec.cell)
        if not taxonomy.is_valid_label(rec.label.value):
            reasons.append(f"label: '{rec.label}' not in approved taxonomy")

        # 3 · Business rules
        rule_reasons = self._record_rules(rec)
        rules_ok = not rule_reasons
        reasons += [f"rule: {r}" for r in rule_reasons]

        return ValidationReport(
            record_id=rec.id, schema_ok=schema_ok, label_ok=label_ok,
            rules_ok=rules_ok, reasons=reasons,
        )

    def _record_rules(self, rec: SyntheticRecord) -> List[str]:
        out: List[str] = []
        # The rationale must not be the text verbatim (indicates a lazy generation).
        if rec.rationale and rec.rationale.strip() == rec.text.strip():
            out.append("rationale duplicates the record text")
        # Risk / Mitigation records should carry a risk_category for coverage work.
        if rec.element_type in (ElementType.RISK, ElementType.MITIGATION) and not (
            rec.risk_category and rec.risk_category.strip()
        ):
            out.append(f"{rec.element_type.value} record must set a risk_category")
        return out

    def validate_records(self, records: List[SyntheticRecord]) -> List[ValidationReport]:
        return [self.validate_record(r) for r in records]

    # ------------------------------------------------------------------
    # Coverage consistency for relationship examples
    # ------------------------------------------------------------------

    def validate_relationships(
        self, rels: List[SyntheticRelationship], id_to_type: Dict[str, ElementType],
    ) -> Dict[str, List[str]]:
        """Return {relationship_id: reasons} — empty reasons ⇒ consistent."""
        out: Dict[str, List[str]] = {}
        for rel in rels:
            src_t: Optional[ElementType] = id_to_type.get(rel.source_record_id)
            tgt_t: Optional[ElementType] = id_to_type.get(rel.target_record_id)
            out[rel.id] = taxonomy.relationship_reasons(rel, src_t, tgt_t)
        return out
