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
# Default taxonomy labels
# ---------------------------------------------------------------------------
#
# Labels are now *strings* and configurable per project (a project may add its
# own, e.g. "Insurance", "Data Privacy"). ``TaxonomyLabel`` remains the seed
# for the default set. Element TYPES stay a fixed enum — they are a structural
# contract with the Analysis knowledge graph.

DEFAULT_LABELS: List[str] = [l.value for l in TaxonomyLabel]

TAXONOMY_DESCRIPTIONS: Dict[str, str] = {
    "Legal": "Legal terms, obligations, governing law, indemnity, IP, dispute resolution.",
    "Financial": "Pricing, payment terms, invoicing, advance payments, fees, financial caps.",
    "Technical": "Technical specifications, deliverables, architecture, SLAs on performance.",
    "KPI": "Measurable performance targets, service levels, uptime, response/resolution times.",
    "Risk": "Potential negative outcomes, breach scenarios, exposure and their likelihood.",
    "Compliance": "Regulatory, statutory, audit, certification and policy-adherence obligations.",
    "Liquidated Damages": "Pre-agreed monetary penalties for defined non-performance events.",
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
# The ElementType × Label matrix (label set is per project)
# ---------------------------------------------------------------------------

# Natural pairings the UI pre-selects / generation leans toward (default labels).
RECOMMENDED_LABELS: Dict[ElementType, List[str]] = {
    ElementType.REQUIREMENT: ["Technical", "KPI", "Compliance", "Legal"],
    ElementType.CLAUSE: ["Legal", "Financial", "Compliance", "Technical"],
    ElementType.RISK: ["Risk", "Compliance", "Financial", "Technical"],
    ElementType.MITIGATION: ["Risk", "Compliance", "Technical"],
    ElementType.LD: ["Liquidated Damages", "Financial", "KPI"],
}


def resolve_labels(labels: Optional[List[str]]) -> List[str]:
    """Return a usable label set — the project's labels or the defaults."""
    return [l for l in (labels or []) if str(l).strip()] or list(DEFAULT_LABELS)


def all_cells(labels: Optional[List[str]] = None) -> List[MatrixCell]:
    """Every (ElementType × label) cell for the given label set."""
    lbls = resolve_labels(labels)
    return [MatrixCell(et, lbl) for et in ElementType for lbl in lbls]


def recommended_cells(labels: Optional[List[str]] = None) -> List[MatrixCell]:
    """Natural pairings that also exist in the given label set."""
    lbls = set(resolve_labels(labels))
    return [
        MatrixCell(et, lbl)
        for et, rec in RECOMMENDED_LABELS.items()
        for lbl in rec if lbl in lbls
    ]


def is_valid_cell(cell: MatrixCell, labels: Optional[List[str]] = None) -> bool:
    return isinstance(cell.element_type, ElementType) and cell.label in resolve_labels(labels)


def is_valid_label(label: str, labels: Optional[List[str]] = None) -> bool:
    """Label Validity: is *label* a member of this project's taxonomy?"""
    return label in resolve_labels(labels)


def label_description(label: str) -> str:
    return TAXONOMY_DESCRIPTIONS.get(label, "")


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
