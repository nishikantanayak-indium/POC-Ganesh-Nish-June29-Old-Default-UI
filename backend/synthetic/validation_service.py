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

from core.models import ElementType, DocumentType

from .models import SyntheticRecord, SyntheticRelationship, ValidationReport
from .schemas import validate_record_payload
from . import taxonomy

logger = logging.getLogger(__name__)


class SyntheticDataValidationService:
    """Core #2 — validation."""

    def _record_payload(self, rec: SyntheticRecord) -> dict:
        return {
            "element_type": rec.element_type.value,
            "label": rec.label,
            "text": rec.text,
            "rationale": rec.rationale,
            "industry": rec.industry,
            "doc_type": rec.doc_type.value,
            "language": rec.language,
            "risk_category": rec.risk_category,
            "clause_structure": rec.clause_structure,
            "attributes": rec.attributes,
        }

    def validate_record(
        self, rec: SyntheticRecord, allowed_labels: Optional[List[str]] = None,
    ) -> ValidationReport:
        reasons: List[str] = []

        # 1 · Schema Validity
        schema_ok, schema_errs = validate_record_payload(self._record_payload(rec))
        reasons += [f"schema: {e}" for e in schema_errs]

        # 2 · Label Validity — against the project's label set
        label_ok = taxonomy.is_valid_label(rec.label, allowed_labels)
        if not label_ok:
            reasons.append(f"label: '{rec.label}' not in the project's taxonomy")

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

    def validate_records(
        self, records: List[SyntheticRecord], allowed_labels: Optional[List[str]] = None,
    ) -> List[ValidationReport]:
        return [self.validate_record(r, allowed_labels) for r in records]

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

    def validate_document_content(self, doc_type: DocumentType, markdown: str, sections: List[dict], length_mode: str = "extended") -> List[str]:
        """
        Run deterministic per-document quality and compliance checks on the generated document content.
        Returns a list of error/warning strings (empty list means all checks passed).
        """
        import re
        errors = []
        from .canonical_schemas import get_canonical_schema
        schema = get_canonical_schema(doc_type, length_mode)

        # 1. Schema Check
        headings_in_doc = {s.get("heading", "").strip().lower() for s in sections}
        for s in schema:
            if s["mandatory"] and s["heading"].strip().lower() not in headings_in_doc:
                errors.append(f"Missing mandatory section: '{s['heading']}'")

        # 2. Placeholder Check
        # Match standard placeholder format: [ASSUMPTION: ...] or [TBD: ...]
        # (These are allowed but should be reported)
        placeholders = re.findall(r"\[(TBD|ASSUMPTION)\s*:\s*([^\]]+)\]", markdown, re.IGNORECASE)

        # 3. Document-Type Specific Checks
        if doc_type == DocumentType.RFP:
            # Check for requirement IDs (FR-/TR-/NFR-)
            req_ids = re.findall(r"\b(FR|TR|NFR)-\d+\b", markdown)
            if not req_ids:
                errors.append("RFP does not contain any Requirement IDs (FR-XXX, TR-XXX, NFR-XXX).")

        elif doc_type == DocumentType.CONTRACT:
            # Disclaimer check: must exist in Summary/Parties/Recitals and Signatures
            disclaimer_text = "reviewed by qualified legal counsel"
            has_summary_disclaimer = False
            has_signatures_disclaimer = False
            for sec in sections:
                heading = sec.get("heading", "").lower()
                body = sec.get("body", "")
                if ("summary" in heading or "parties" in heading or "recitals" in heading) and disclaimer_text in body.lower():
                    has_summary_disclaimer = True
                if "signature" in heading and disclaimer_text in body.lower():
                    has_signatures_disclaimer = True
            
            if not has_summary_disclaimer:
                errors.append("Contract is missing the legal disclaimer in the Summary/Parties/Recitals section.")
            if not has_signatures_disclaimer:
                errors.append("Contract is missing the legal disclaimer in the Signatures section.")

            # Order of Precedence check (only mandatory in extended mode, or general precedence check if present)
            # In compact mode, we might not have a standalone Order of Precedence section.
            if length_mode == "extended":
                has_precedence = any("precedence" in sec.get("heading", "").lower() for sec in sections)
                if not has_precedence:
                    errors.append("Contract is missing the 'Order of Precedence' clause section.")

        elif doc_type == DocumentType.RISK_SHEET:
            # Check risk Register math and vocabulary
            register_body = ""
            for sec in sections:
                if "register" in sec.get("heading", "").lower():
                    register_body = sec.get("body", "")
                    break
            
            if register_body:
                lines = register_body.splitlines()
                headers = []
                table_started = False
                for line in lines:
                    if line.strip().startswith("|"):
                        cells = [c.strip() for c in line.split("|")[1:-1]]
                        if not table_started:
                            headers = [h.lower() for h in cells]
                            table_started = True
                            continue
                        if table_started and (line.replace(" ", "").replace("-", "").strip() == "||" or all(c.strip() == "-" or c.strip() == ":" or set(c.strip()) == {"-"} for c in cells)):
                            continue
                        
                        row_dict = dict(zip(headers, cells))
                        
                        # Validate Math: Score = Likelihood * Impact
                        likelihood_str = row_dict.get("likelihood", "").strip()
                        impact_str = row_dict.get("impact severity", "").strip() or row_dict.get("impact", "").strip()
                        score_str = row_dict.get("risk score", "").strip() or row_dict.get("score", "").strip()
                        rating_str = row_dict.get("risk rating", "").strip() or row_dict.get("rating", "").strip()
                        
                        try:
                            l_val = int(re.search(r"\d+", likelihood_str).group())
                            i_val = int(re.search(r"\d+", impact_str).group())
                            s_val = int(re.search(r"\d+", score_str).group())
                            
                            if not (1 <= l_val <= 5) or not (1 <= i_val <= 5):
                                errors.append(f"Risk register Likelihood ({l_val}) or Impact ({i_val}) out of 1-5 bounds.")
                            
                            expected_score = l_val * i_val
                            if s_val != expected_score:
                                errors.append(f"Risk score calculation error: Likelihood {l_val} * Impact {i_val} = {expected_score}, but document states score is {s_val}.")
                            
                            expected_rating = "Low"
                            if 5 <= expected_score <= 9:
                                expected_rating = "Medium"
                            elif 10 <= expected_score <= 16:
                                expected_rating = "High"
                            elif 17 <= expected_score <= 25:
                                expected_rating = "Critical"
                            
                            if rating_str.lower() != expected_rating.lower():
                                errors.append(f"Risk rating error: Score {expected_score} should be rated '{expected_rating}', but document states rating is '{rating_str}'.")
                        except (AttributeError, ValueError, TypeError):
                            errors.append(f"Risk row could not be parsed for math validation: likelihood='{likelihood_str}', impact='{impact_str}'")

                        # Validate Vocabularies
                        cat = row_dict.get("risk category", "").strip()
                        status = row_dict.get("status", "").strip()
                        
                        allowed_categories = {
                            "commercial/financial", "legal/compliance", "delivery/schedule", 
                            "technical/solution", "operational", "security/data protection", 
                            "vendor/third-party", "reputational/strategic"
                        }
                        allowed_statuses = {"open", "in review", "mitigated", "closed", "accepted"}
                        
                        if cat and cat.lower() not in allowed_categories:
                            errors.append(f"Invalid risk category '{cat}'.")
                        if status and status.lower() not in allowed_statuses:
                            errors.append(f"Invalid risk status '{status}'.")

        return errors

    def validate_cross_document_consistency(self, documents: List[SyntheticDocument]) -> List[str]:
        """
        Run deterministic consistency checks across multiple documents in a linked deal package.
        """
        import re
        errors = []
        if len(documents) < 2:
            return errors

        doc_map = {d.doc_type: d for d in documents}
        
        # 1. Definitions/Glossary term propagation check
        definitions_by_doc = {}
        for dtype, doc in doc_map.items():
            defs = set()
            for sec in doc.sections:
                if "definition" in sec.get("heading", "").lower() or "glossary" in sec.get("heading", "").lower():
                    raw_terms = re.findall(r"\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`", sec.get("body", ""))
                    terms = [t for match in raw_terms for t in match if t]
                    defs.update(t.strip().lower() for t in terms)
            definitions_by_doc[dtype] = defs

        if DocumentType.RFP in definitions_by_doc and DocumentType.CONTRACT in definitions_by_doc:
            rfp_defs = definitions_by_doc[DocumentType.RFP]
            contract_defs = definitions_by_doc[DocumentType.CONTRACT]
            missing_in_contract = rfp_defs - contract_defs
            if missing_in_contract:
                errors.append(f"Definitions from RFP missing in Contract: {', '.join(missing_in_contract)}")

        # 2. Requirement / Deliverable IDs consistency
        req_ids_by_doc = {}
        for dtype, doc in doc_map.items():
            matches = re.findall(r"\b(?:FR|TR|NFR)\s*[-–]\s*\d+\b", _doc_type_text(doc), re.IGNORECASE)
            ids = set(re.sub(r"\s*[-–]\s*", "-", m).upper() for m in matches)
            req_ids_by_doc[dtype] = ids

        if DocumentType.RFP in req_ids_by_doc and DocumentType.CONTRACT in req_ids_by_doc:
            rfp_ids = req_ids_by_doc[DocumentType.RFP]
            contract_ids = req_ids_by_doc[DocumentType.CONTRACT]
            missing_ids = rfp_ids - contract_ids
            if missing_ids:
                errors.append(f"Requirement IDs from RFP missing in Contract SOW/Deliverables: {', '.join(missing_ids)}")

        # 3. Risk Reference checking
        if DocumentType.RISK_SHEET in doc_map:
            risk_doc = doc_map[DocumentType.RISK_SHEET]
            risk_text = _doc_type_text(risk_doc)
            refs = re.findall(r"\b(?:RFP §\d+, (?:FR|TR|NFR)-\d+|Contract Cl\. \d+\.\d+)\b", risk_text)
            if not refs:
                errors.append("Risk Sheet does not contain properly formatted Source Document References.")

        return errors


def _doc_type_text(doc: SyntheticDocument) -> str:
    return "\n".join(s.get("body", "") for s in doc.sections)

