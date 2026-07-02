"""
Business taxonomy, the ElementType × TaxonomyLabel matrix, and the domain
business rules used by the Validation service (label validity + coverage
consistency / direction enforcement).

Everything here is data + pure functions so it is trivial to unit-test and to
extend (add a label, a cell restriction, or a rule without touching services).
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from core.models import CoverageStatus, DocumentType, ElementType, RelationshipType

from .models import MatrixCell, SyntheticRelationship, TaxonomyLabel

# ---------------------------------------------------------------------------
# Approved dictionaries (drive Label Validity)
# ---------------------------------------------------------------------------

TAXONOMY_DESCRIPTIONS: Dict[TaxonomyLabel, str] = {
    TaxonomyLabel.LEGAL: "Legal terms, obligations, governing law, indemnity, IP, dispute resolution.",
    TaxonomyLabel.FINANCIAL: "Pricing, payment terms, invoicing, advance payments, fees, financial caps.",
    TaxonomyLabel.TECHNICAL: "Technical specifications, deliverables, architecture, SLAs on performance.",
    TaxonomyLabel.KPI: "Measurable performance targets, service levels, uptime, response/resolution times.",
    TaxonomyLabel.RISK: "Potential negative outcomes, breach scenarios, exposure and their likelihood.",
    TaxonomyLabel.COMPLIANCE: "Regulatory, statutory, audit, certification and policy-adherence obligations.",
    TaxonomyLabel.LIQUIDATED_DAMAGES: "Pre-agreed monetary penalties for defined non-performance events.",
}

ELEMENT_DESCRIPTIONS: Dict[ElementType, str] = {
    ElementType.REQUIREMENT: "A measurable obligation the vendor MUST fulfil.",
    ElementType.CLAUSE: "A contractual term or condition from an agreement.",
    ElementType.RISK: "An explicit potential negative outcome or breach scenario.",
    ElementType.MITIGATION: "An action or mechanism that reduces a specific risk.",
    ElementType.LD: "A liquidated-damages / financial penalty tied to non-performance.",
}

# Diversity dimensions (defaults; the UI can override per generation run)
DEFAULT_INDUSTRIES: List[str] = [
    "IT Services", "Construction", "Healthcare", "Manufacturing",
    "Financial Services", "Energy", "Logistics", "Public Sector",
]
DEFAULT_LANGUAGES: List[str] = ["en"]
DEFAULT_DOC_TYPES: List[DocumentType] = [
    DocumentType.RFP, DocumentType.CONTRACT, DocumentType.RISK_SHEET,
]

# ---------------------------------------------------------------------------
# The ElementType × TaxonomyLabel matrix
# ---------------------------------------------------------------------------

# All combinations are valid cells (2-level matrix), so coverage/diversity
# analysis spans the full space. RECOMMENDED_LABELS marks the natural pairings
# that the UI pre-selects and that generation prompts lean toward.
RECOMMENDED_LABELS: Dict[ElementType, List[TaxonomyLabel]] = {
    ElementType.REQUIREMENT: [
        TaxonomyLabel.TECHNICAL, TaxonomyLabel.KPI, TaxonomyLabel.COMPLIANCE, TaxonomyLabel.LEGAL,
    ],
    ElementType.CLAUSE: [
        TaxonomyLabel.LEGAL, TaxonomyLabel.FINANCIAL, TaxonomyLabel.COMPLIANCE, TaxonomyLabel.TECHNICAL,
    ],
    ElementType.RISK: [
        TaxonomyLabel.RISK, TaxonomyLabel.COMPLIANCE, TaxonomyLabel.FINANCIAL, TaxonomyLabel.TECHNICAL,
    ],
    ElementType.MITIGATION: [
        TaxonomyLabel.RISK, TaxonomyLabel.COMPLIANCE, TaxonomyLabel.TECHNICAL,
    ],
    ElementType.LD: [
        TaxonomyLabel.LIQUIDATED_DAMAGES, TaxonomyLabel.FINANCIAL, TaxonomyLabel.KPI,
    ],
}


def all_cells() -> List[MatrixCell]:
    """Every valid (ElementType × TaxonomyLabel) cell — 5 × 7 = 35."""
    return [MatrixCell(et, lbl) for et in ElementType for lbl in TaxonomyLabel]


def recommended_cells() -> List[MatrixCell]:
    """The natural pairings, pre-selected in the UI."""
    return [
        MatrixCell(et, lbl)
        for et, labels in RECOMMENDED_LABELS.items()
        for lbl in labels
    ]


def is_valid_cell(cell: MatrixCell) -> bool:
    """All element/label pairings are permitted in the 2-level matrix."""
    return isinstance(cell.element_type, ElementType) and isinstance(cell.label, TaxonomyLabel)


def is_valid_label(label: str) -> bool:
    """Label Validity: is *label* a member of the approved taxonomy?"""
    return label in {l.value for l in TaxonomyLabel}


# ---------------------------------------------------------------------------
# Relationship direction rules (Coverage Consistency)
# ---------------------------------------------------------------------------

# rel_type -> (allowed source element types, allowed target element types)
REL_DIRECTION: Dict[RelationshipType, Tuple[List[ElementType], List[ElementType]]] = {
    RelationshipType.COVERS: ([ElementType.CLAUSE], [ElementType.REQUIREMENT]),
    RelationshipType.PARTIALLY_COVERS: ([ElementType.CLAUSE], [ElementType.REQUIREMENT]),
    RelationshipType.INTRODUCES_RISK: ([ElementType.REQUIREMENT], [ElementType.RISK]),
    RelationshipType.MITIGATED_BY: ([ElementType.RISK], [ElementType.MITIGATION]),
    RelationshipType.LINKED_TO_LD: ([ElementType.RISK, ElementType.REQUIREMENT], [ElementType.LD]),
    RelationshipType.CONTRADICTS: ([ElementType.CLAUSE], [ElementType.CLAUSE]),
}

# Relationship types that carry a Covered/Partial/NotCovered label
COVERAGE_REL_TYPES = {RelationshipType.COVERS, RelationshipType.PARTIALLY_COVERS}


def relationship_reasons(
    rel: SyntheticRelationship,
    src_type: Optional[ElementType],
    tgt_type: Optional[ElementType],
) -> List[str]:
    """
    Return a list of coverage-consistency violations for *rel* (empty ⇒ valid).

    Checks: endpoint types exist, direction matches REL_DIRECTION, and the
    coverage_label is only present on coverage relationship types (and, for a
    positive COVERS pair, is not 'Not Covered').
    """
    reasons: List[str] = []

    if src_type is None or tgt_type is None:
        reasons.append("relationship references an unknown record endpoint")
        return reasons

    allowed = REL_DIRECTION.get(rel.rel_type)
    if not allowed:
        reasons.append(f"unsupported relationship type {rel.rel_type.value}")
        return reasons

    src_ok, tgt_ok = allowed
    if src_type not in src_ok:
        reasons.append(
            f"{rel.rel_type.value} source must be one of "
            f"{[t.value for t in src_ok]}, got {src_type.value}"
        )
    if tgt_type not in tgt_ok:
        reasons.append(
            f"{rel.rel_type.value} target must be one of "
            f"{[t.value for t in tgt_ok]}, got {tgt_type.value}"
        )

    if rel.coverage_label is not None and rel.rel_type not in COVERAGE_REL_TYPES:
        reasons.append(
            f"coverage_label is only valid on {[t.value for t in COVERAGE_REL_TYPES]}"
        )

    # A positive COVERS example labelled 'Not Covered' is contradictory.
    if (
        rel.is_positive
        and rel.rel_type == RelationshipType.COVERS
        and rel.coverage_label == CoverageStatus.NOT_COVERED
    ):
        reasons.append("positive COVERS pair cannot be labelled 'Not Covered'")

    return reasons
