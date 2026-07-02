"""
Pydantic models + JSON Schema for the Synthetic Data *Schema Validity* check.

Every generated record is validated against these before it can be staged.
The models are also the single source of truth for the JSON Schema the UI
displays and for the type-specific attributes the Generation service must
produce, so structure stays consistent end-to-end.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from core.models import CoverageStatus, DocumentType, ElementType, RelationshipType

from .models import TaxonomyLabel

# Type-specific attribute keys each element type must carry. Keeping these
# here (not in the service) means adding a required field is a one-line change.
REQUIRED_ATTRS: Dict[ElementType, List[str]] = {
    ElementType.REQUIREMENT: ["obligation"],
    ElementType.CLAUSE: ["clause_type"],
    ElementType.RISK: ["impact"],
    ElementType.MITIGATION: ["mechanism"],
    ElementType.LD: ["penalty_basis"],
}


class RecordPayload(BaseModel):
    """Structural contract for a single generated atomic record."""

    model_config = ConfigDict(extra="ignore", use_enum_values=False)

    element_type: ElementType
    label: TaxonomyLabel
    text: str = Field(min_length=15, description="The natural-language artifact text.")
    rationale: str = Field(default="", description="Why this is a realistic example.")
    industry: str = Field(default="General", min_length=1)
    doc_type: DocumentType = DocumentType.CONTRACT
    language: str = Field(default="en", min_length=2, max_length=8)
    risk_category: Optional[str] = None
    clause_structure: Optional[str] = None
    attributes: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _require_type_attrs(self) -> "RecordPayload":
        missing = [
            k for k in REQUIRED_ATTRS.get(self.element_type, [])
            if not str(self.attributes.get(k, "")).strip()
        ]
        if missing:
            raise ValueError(
                f"{self.element_type.value} record missing required attribute(s): "
                f"{', '.join(missing)}"
            )
        return self


class RelationshipPayload(BaseModel):
    """Structural contract for a generated relationship / mapping example."""

    model_config = ConfigDict(extra="ignore", use_enum_values=False)

    rel_type: RelationshipType
    source_text: str = Field(min_length=10)
    target_text: str = Field(min_length=10)
    coverage_label: Optional[CoverageStatus] = None
    is_positive: bool = True
    rationale: str = ""


def validate_record_payload(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Return (ok, error_messages) for a candidate record dict."""
    try:
        RecordPayload.model_validate(data)
        return True, []
    except ValidationError as exc:
        return False, [_fmt_error(e) for e in exc.errors()]


def validate_relationship_payload(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Return (ok, error_messages) for a candidate relationship dict."""
    try:
        RelationshipPayload.model_validate(data)
        return True, []
    except ValidationError as exc:
        return False, [_fmt_error(e) for e in exc.errors()]


def _fmt_error(err: dict) -> str:
    loc = ".".join(str(p) for p in err.get("loc", ())) or "record"
    return f"{loc}: {err.get('msg', 'invalid')}"


def record_json_schema() -> dict:
    """JSON Schema for a record — surfaced in the UI's Validate tab."""
    return RecordPayload.model_json_schema()


def relationship_json_schema() -> dict:
    return RelationshipPayload.model_json_schema()
