"""
Synthetic Data Studio — a parallel product area to Analysis.

Four core services generate, validate, quality-check, and manage synthetic
procurement artifacts (requirements, clauses, risks, mitigations, LDs, and
whole contracts), plus an SME-review surface. Accepted, SME-approved datasets
are promoted from staging to main storage and can then be published into an
Analysis workspace (feeding the existing knowledge-graph pipeline).

Sub-modules:
    models      — domain dataclasses + enums (SyntheticRecord, reports, ...)
    taxonomy    — label taxonomy, the ElementType×Label matrix, business rules
    schemas     — Pydantic models / JSON Schema for schema-validity checks
    storage     — artifact store abstraction (S3/MinIO default, local fallback)
    db          — PostgreSQL persistence for Studio metadata
    generation_service  — SyntheticDataGenerationService
    validation_service  — SyntheticDataValidationService
    quality_service     — SyntheticDataQualityAssessmentService
    sme_service         — sampling + SME verdict capture + feedback
    dataset_service     — SyntheticDatasetManagementService (versioning/lineage/publish)
"""
