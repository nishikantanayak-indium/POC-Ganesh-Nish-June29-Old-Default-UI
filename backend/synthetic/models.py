"""
Domain models for the Synthetic Data Studio.

Plain dataclasses + enums, matching the style of :mod:`core.models`.
``ElementType`` is reused from the Analysis domain so that published
synthetic records map cleanly onto the existing knowledge graph.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from core.models import CoverageStatus, DocumentType, ElementType, RelationshipType


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class TaxonomyLabel(str, Enum):
    """Approved business-taxonomy classification labels."""

    LEGAL = "Legal"
    FINANCIAL = "Financial"
    TECHNICAL = "Technical"
    KPI = "KPI"
    RISK = "Risk"
    COMPLIANCE = "Compliance"
    LIQUIDATED_DAMAGES = "Liquidated Damages"


class DatasetStatus(str, Enum):
    """A dataset lives in staging until promoted to the main repository."""

    STAGING = "staging"
    MAIN = "main"


class RecordStatus(str, Enum):
    """Lifecycle of a single synthetic record."""

    CANDIDATE = "candidate"        # freshly generated, not yet validated
    REJECTED = "rejected"          # failed schema / label / business-rule validation
    DUPLICATE = "duplicate"        # flagged by duplicate detection
    STAGED = "staged"              # validated + quality-checked, in staging storage
    SME_APPROVED = "sme_approved"  # SME accepted
    SME_REJECTED = "sme_rejected"  # SME rejected
    PUBLISHED = "published"        # promoted to main + published to an Analysis workspace


class SMEVerdict(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    EDIT = "edit"


# ---------------------------------------------------------------------------
# Matrix cell (ElementType × TaxonomyLabel)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MatrixCell:
    """A single cell of the ElementType × TaxonomyLabel coverage matrix."""

    element_type: ElementType
    label: TaxonomyLabel

    @property
    def key(self) -> str:
        return f"{self.element_type.value}|{self.label.value}"

    @classmethod
    def from_key(cls, key: str) -> "MatrixCell":
        et, lbl = key.split("|", 1)
        return cls(ElementType(et), TaxonomyLabel(lbl))

    def to_dict(self) -> dict:
        return {"element_type": self.element_type.value, "label": self.label.value, "key": self.key}


# ---------------------------------------------------------------------------
# Synthetic record + reports
# ---------------------------------------------------------------------------


@dataclass
class SyntheticRecord:
    """
    A single generated synthetic artifact.

    ``attributes`` holds type-specific structured fields (e.g. an LD's
    penalty_rate, a Clause's clause_type). The diversity dimensions
    (industry / doc_type / language / risk_category / clause_structure) are
    first-class because the Quality service analyses their distribution.
    """

    id: str
    project_id: str
    element_type: ElementType
    label: TaxonomyLabel
    text: str
    rationale: str = ""
    industry: str = "General"
    doc_type: DocumentType = DocumentType.CONTRACT
    language: str = "en"
    risk_category: Optional[str] = None
    clause_structure: Optional[str] = None
    status: RecordStatus = RecordStatus.CANDIDATE
    attributes: Dict[str, Any] = field(default_factory=dict)
    provenance: Dict[str, Any] = field(default_factory=dict)
    version_id: Optional[str] = None
    embedding_id: Optional[int] = None
    created_at: Optional[datetime] = None

    @property
    def cell(self) -> MatrixCell:
        return MatrixCell(self.element_type, self.label)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "version_id": self.version_id,
            "element_type": self.element_type.value,
            "label": self.label.value,
            "cell": self.cell.key,
            "text": self.text,
            "rationale": self.rationale,
            "industry": self.industry,
            "doc_type": self.doc_type.value,
            "language": self.language,
            "risk_category": self.risk_category,
            "clause_structure": self.clause_structure,
            "status": self.status.value,
            "attributes": self.attributes,
            "provenance": self.provenance,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


@dataclass
class SyntheticRelationship:
    """
    A labeled relationship / mapping example between two synthetic records.

    This is the training data for coverage and relationship classification and
    the subject of the Validation service's *Coverage Consistency* check.

    * For COVERS / PARTIALLY_COVERS pairs, ``coverage_label`` carries the
      Covered / Partially Covered / Not Covered target.
    * ``is_positive=False`` marks a deliberate **negative example** (e.g. a
      Not-Covered pair, or a mitigation that does *not* address the risk) so
      downstream models see balanced positive/negative supervision.
    """

    id: str
    project_id: str
    source_record_id: str
    target_record_id: str
    rel_type: RelationshipType
    coverage_label: Optional[CoverageStatus] = None
    is_positive: bool = True
    rationale: str = ""
    status: RecordStatus = RecordStatus.CANDIDATE
    attributes: Dict[str, Any] = field(default_factory=dict)
    provenance: Dict[str, Any] = field(default_factory=dict)
    version_id: Optional[str] = None
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "version_id": self.version_id,
            "source_record_id": self.source_record_id,
            "target_record_id": self.target_record_id,
            "rel_type": self.rel_type.value,
            "coverage_label": self.coverage_label.value if self.coverage_label else None,
            "is_positive": self.is_positive,
            "rationale": self.rationale,
            "status": self.status.value,
            "attributes": self.attributes,
            "provenance": self.provenance,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


@dataclass
class SyntheticDocument:
    """
    A composite artifact — a whole synthetic Contract / RFP / Risk Sheet
    assembled from member records into a coherent, sectioned document.

    The rendered document (Markdown) is stored in the artifact store;
    ``artifact_uri`` points to it. ``sections`` records the assembly plan
    (heading → member record IDs) so the composite is fully traceable.
    """

    id: str
    project_id: str
    doc_type: DocumentType
    title: str
    member_record_ids: List[str] = field(default_factory=list)
    sections: List[Dict[str, Any]] = field(default_factory=list)  # [{heading, record_ids, body}]
    artifact_uri: str = ""
    status: RecordStatus = RecordStatus.STAGED
    provenance: Dict[str, Any] = field(default_factory=dict)
    version_id: Optional[str] = None
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project_id": self.project_id,
            "version_id": self.version_id,
            "doc_type": self.doc_type.value,
            "title": self.title,
            "member_record_ids": self.member_record_ids,
            "sections": self.sections,
            "artifact_uri": self.artifact_uri,
            "status": self.status.value,
            "provenance": self.provenance,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


@dataclass
class ValidationReport:
    """Result of the Validation service for one record."""

    record_id: str
    schema_ok: bool
    label_ok: bool
    rules_ok: bool
    reasons: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.schema_ok and self.label_ok and self.rules_ok

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "schema_ok": self.schema_ok,
            "label_ok": self.label_ok,
            "rules_ok": self.rules_ok,
            "passed": self.passed,
            "reasons": self.reasons,
        }


@dataclass
class QualityReport:
    """Result of the Quality service for one record."""

    record_id: str
    realism: float
    is_duplicate: bool
    duplicate_of: Optional[str] = None
    near_dup_score: float = 0.0
    realism_notes: str = ""

    @property
    def passed(self) -> bool:
        # A record passes quality if it is realistic enough and not a duplicate.
        from config.settings import settings
        return (not self.is_duplicate) and self.realism >= settings.synthetic_realism_floor

    def to_dict(self) -> dict:
        return {
            "record_id": self.record_id,
            "realism": round(self.realism, 3),
            "is_duplicate": self.is_duplicate,
            "duplicate_of": self.duplicate_of,
            "near_dup_score": round(self.near_dup_score, 3),
            "realism_notes": self.realism_notes,
            "passed": self.passed,
        }
