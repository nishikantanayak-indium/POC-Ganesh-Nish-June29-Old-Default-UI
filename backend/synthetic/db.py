"""
PostgreSQL persistence for the Synthetic Data Studio.

Synchronous (psycopg2) like :mod:`db.postgres`; wrap calls in
``asyncio.to_thread`` from async routes. Structured metadata lives here; raw
artifacts (records JSONL, rendered documents) live in the artifact store.

Entity map
----------
projects        1─┐
                  ├─< datasets (containers) 1─< versions (snapshots; staging|main)
versions 1─< records / relationships / documents
records  1─1 validation_reports, quality_reports
records  1─< sme_reviews
projects 1─< lineage_edges
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional

import psycopg2
import psycopg2.extras

from config.settings import settings
from core.models import CoverageStatus, DocumentType, ElementType, RelationshipType

from .models import (
    DatasetStatus,
    QualityReport,
    RecordStatus,
    SMEVerdict,
    SyntheticDocument,
    SyntheticRecord,
    SyntheticRelationship,
    TaxonomyLabel,
    ValidationReport,
)

# ---------------------------------------------------------------------------
# Lightweight container dataclasses (projects / datasets / versions / reviews)
# ---------------------------------------------------------------------------


_DEFAULT_LABELS = [l.value for l in TaxonomyLabel]


@dataclass
class Project:
    id: str
    name: str
    description: str
    min_threshold: int
    seed_summary: Optional[dict]
    labels: Optional[list]
    created_at: datetime
    updated_at: datetime

    @property
    def label_set(self) -> list:
        return [l for l in (self.labels or []) if str(l).strip()] or list(_DEFAULT_LABELS)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "min_threshold": self.min_threshold,
            "seed_summary": self.seed_summary,
            "labels": self.label_set,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass
class Dataset:
    id: str
    project_id: str
    name: str
    status: str
    created_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id, "project_id": self.project_id, "name": self.name,
            "status": self.status, "created_at": self.created_at.isoformat(),
        }


@dataclass
class Version:
    id: str
    dataset_id: str
    project_id: str
    version_no: int
    status: str
    note: str
    artifact_uri: str
    stats: Optional[dict]
    created_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id, "dataset_id": self.dataset_id, "project_id": self.project_id,
            "version_no": self.version_no, "status": self.status, "note": self.note,
            "artifact_uri": self.artifact_uri, "stats": self.stats,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class SMEReviewRow:
    id: str
    record_id: str
    reviewer: str
    verdict: str
    corrected_label: Optional[str]
    corrected_text: Optional[str]
    comment: str
    created_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id, "record_id": self.record_id, "reviewer": self.reviewer,
            "verdict": self.verdict, "corrected_label": self.corrected_label,
            "corrected_text": self.corrected_text, "comment": self.comment,
            "created_at": self.created_at.isoformat(),
        }


_db_ready = False


def _conn():
    return psycopg2.connect(settings.postgres_url)


def init_synthetic_db() -> None:
    """Create all Studio tables + indexes (idempotent)."""
    global _db_ready
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_projects (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                description   TEXT NOT NULL DEFAULT '',
                min_threshold INTEGER NOT NULL DEFAULT 5,
                seed_summary  JSONB,
                labels        JSONB,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Migration for pre-existing installs (CREATE IF NOT EXISTS won't add columns).
        cur.execute("ALTER TABLE synthetic_projects ADD COLUMN IF NOT EXISTS labels JSONB")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_datasets (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                name       TEXT NOT NULL DEFAULT 'Default',
                status     TEXT NOT NULL DEFAULT 'staging',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_versions (
                id           TEXT PRIMARY KEY,
                dataset_id   TEXT NOT NULL REFERENCES synthetic_datasets(id) ON DELETE CASCADE,
                project_id   TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                version_no   INTEGER NOT NULL,
                status       TEXT NOT NULL DEFAULT 'staging',
                note         TEXT NOT NULL DEFAULT '',
                artifact_uri TEXT NOT NULL DEFAULT '',
                stats        JSONB,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_records (
                id               TEXT PRIMARY KEY,
                project_id       TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                version_id       TEXT REFERENCES synthetic_versions(id) ON DELETE CASCADE,
                element_type     TEXT NOT NULL,
                label            TEXT NOT NULL,
                text             TEXT NOT NULL,
                rationale        TEXT NOT NULL DEFAULT '',
                industry         TEXT NOT NULL DEFAULT 'General',
                doc_type         TEXT NOT NULL DEFAULT 'Contract',
                language         TEXT NOT NULL DEFAULT 'en',
                risk_category    TEXT,
                clause_structure TEXT,
                status           TEXT NOT NULL DEFAULT 'candidate',
                attributes       JSONB,
                provenance       JSONB,
                embedding_id     BIGINT,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_relationships (
                id               TEXT PRIMARY KEY,
                project_id       TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                version_id       TEXT REFERENCES synthetic_versions(id) ON DELETE CASCADE,
                source_record_id TEXT NOT NULL,
                target_record_id TEXT NOT NULL,
                rel_type         TEXT NOT NULL,
                coverage_label   TEXT,
                is_positive      BOOLEAN NOT NULL DEFAULT TRUE,
                rationale        TEXT NOT NULL DEFAULT '',
                status           TEXT NOT NULL DEFAULT 'candidate',
                attributes       JSONB,
                provenance       JSONB,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_documents (
                id                TEXT PRIMARY KEY,
                project_id        TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                version_id        TEXT REFERENCES synthetic_versions(id) ON DELETE CASCADE,
                doc_type          TEXT NOT NULL,
                title             TEXT NOT NULL,
                member_record_ids JSONB,
                sections          JSONB,
                artifact_uri      TEXT NOT NULL DEFAULT '',
                status            TEXT NOT NULL DEFAULT 'staged',
                provenance        JSONB,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_validation_reports (
                record_id TEXT PRIMARY KEY REFERENCES synthetic_records(id) ON DELETE CASCADE,
                schema_ok BOOLEAN NOT NULL,
                label_ok  BOOLEAN NOT NULL,
                rules_ok  BOOLEAN NOT NULL,
                reasons   JSONB
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_quality_reports (
                record_id     TEXT PRIMARY KEY REFERENCES synthetic_records(id) ON DELETE CASCADE,
                realism       REAL NOT NULL,
                is_duplicate  BOOLEAN NOT NULL,
                duplicate_of  TEXT,
                near_dup_score REAL NOT NULL DEFAULT 0,
                realism_notes TEXT NOT NULL DEFAULT ''
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_sme_reviews (
                id              TEXT PRIMARY KEY,
                record_id       TEXT NOT NULL REFERENCES synthetic_records(id) ON DELETE CASCADE,
                reviewer        TEXT NOT NULL DEFAULT 'sme',
                verdict         TEXT NOT NULL,
                corrected_label TEXT,
                corrected_text  TEXT,
                comment         TEXT NOT NULL DEFAULT '',
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synthetic_lineage (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES synthetic_projects(id) ON DELETE CASCADE,
                from_node  TEXT NOT NULL,
                to_node    TEXT NOT NULL,
                edge_type  TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        for stmt in (
            "CREATE INDEX IF NOT EXISTS idx_syn_ds_project ON synthetic_datasets(project_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_ver_dataset ON synthetic_versions(dataset_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_rec_version ON synthetic_records(version_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_rec_project ON synthetic_records(project_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_rel_version ON synthetic_relationships(version_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_doc_version ON synthetic_documents(version_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_sme_record ON synthetic_sme_reviews(record_id)",
            "CREATE INDEX IF NOT EXISTS idx_syn_lin_project ON synthetic_lineage(project_id)",
        ):
            cur.execute(stmt)
        conn.commit()
    _db_ready = True


def _ensure_init() -> None:
    if not _db_ready:
        init_synthetic_db()


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


def create_project(
    name: str, description: str = "", min_threshold: Optional[int] = None,
    labels: Optional[list] = None,
) -> Project:
    _ensure_init()
    pid = str(uuid.uuid4())
    thr = min_threshold if min_threshold is not None else settings.synthetic_min_threshold
    clean_labels = [str(l).strip() for l in (labels or []) if str(l).strip()] or None
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "INSERT INTO synthetic_projects (id, name, description, min_threshold, labels) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (pid, name.strip(), description.strip(), thr,
             json.dumps(clean_labels) if clean_labels else None),
        )
        row = cur.fetchone()
        conn.commit()
        return Project(**dict(row))


def update_project(
    project_id: str, name: Optional[str] = None, description: Optional[str] = None,
    min_threshold: Optional[int] = None, labels: Optional[list] = None,
) -> Optional[Project]:
    _ensure_init()
    sets, params = [], []
    if name is not None:
        sets.append("name = %s"); params.append(name.strip())
    if description is not None:
        sets.append("description = %s"); params.append(description.strip())
    if min_threshold is not None:
        sets.append("min_threshold = %s"); params.append(min_threshold)
    if labels is not None:
        clean = [str(l).strip() for l in labels if str(l).strip()]
        sets.append("labels = %s"); params.append(json.dumps(clean) if clean else None)
    if not sets:
        return get_project(project_id)
    sets.append("updated_at = NOW()")
    params.append(project_id)
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(f"UPDATE synthetic_projects SET {', '.join(sets)} WHERE id = %s RETURNING *", params)
        row = cur.fetchone()
        conn.commit()
        return Project(**dict(row)) if row else None


def list_projects() -> List[Project]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_projects ORDER BY updated_at DESC")
        return [Project(**dict(r)) for r in cur.fetchall()]


def get_project(project_id: str) -> Optional[Project]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_projects WHERE id = %s", (project_id,))
        row = cur.fetchone()
        return Project(**dict(row)) if row else None


def update_project_seed_summary(project_id: str, summary: dict) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE synthetic_projects SET seed_summary = %s, updated_at = NOW() WHERE id = %s",
            (json.dumps(summary), project_id),
        )
        conn.commit()


def touch_project(project_id: str) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE synthetic_projects SET updated_at = NOW() WHERE id = %s", (project_id,))
        conn.commit()


def delete_project(project_id: str) -> bool:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM synthetic_projects WHERE id = %s", (project_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        return deleted


# ---------------------------------------------------------------------------
# Datasets + versions
# ---------------------------------------------------------------------------


def get_or_create_default_dataset(project_id: str) -> Dataset:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM synthetic_datasets WHERE project_id = %s ORDER BY created_at ASC LIMIT 1",
            (project_id,),
        )
        row = cur.fetchone()
        if row:
            return Dataset(**dict(row))
        did = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO synthetic_datasets (id, project_id, name, status) "
            "VALUES (%s, %s, 'Default', %s) RETURNING *",
            (did, project_id, DatasetStatus.STAGING.value),
        )
        row = cur.fetchone()
        conn.commit()
        return Dataset(**dict(row))


def create_version(project_id: str, dataset_id: str, note: str = "") -> Version:
    _ensure_init()
    vid = str(uuid.uuid4())
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM synthetic_versions WHERE dataset_id = %s",
            (dataset_id,),
        )
        version_no = cur.fetchone()["n"]
        cur.execute(
            "INSERT INTO synthetic_versions (id, dataset_id, project_id, version_no, status, note) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
            (vid, dataset_id, project_id, version_no, DatasetStatus.STAGING.value, note),
        )
        row = cur.fetchone()
        conn.commit()
        return Version(**dict(row))


def get_version(version_id: str) -> Optional[Version]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_versions WHERE id = %s", (version_id,))
        row = cur.fetchone()
        return Version(**dict(row)) if row else None


def list_versions(project_id: str) -> List[Version]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM synthetic_versions WHERE project_id = %s ORDER BY version_no DESC",
            (project_id,),
        )
        return [Version(**dict(r)) for r in cur.fetchall()]


def version_status_counts(project_id: str) -> Dict[str, Dict[str, int]]:
    """Live record-status breakdown per version — reflects SME verdicts as they
    happen (so the Datasets tab isn't stuck on generation-time counts)."""
    _ensure_init()
    out: Dict[str, Dict[str, int]] = {}
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT version_id, status, COUNT(*) FROM synthetic_records "
            "WHERE project_id = %s AND version_id IS NOT NULL GROUP BY version_id, status",
            (project_id,),
        )
        for version_id, status, count in cur.fetchall():
            out.setdefault(version_id, {})[status] = count
    return out


def update_version_stats(version_id: str, stats: dict, artifact_uri: str = "") -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        if artifact_uri:
            cur.execute(
                "UPDATE synthetic_versions SET stats = %s, artifact_uri = %s WHERE id = %s",
                (json.dumps(stats), artifact_uri, version_id),
            )
        else:
            cur.execute(
                "UPDATE synthetic_versions SET stats = %s WHERE id = %s",
                (json.dumps(stats), version_id),
            )
        conn.commit()


def set_version_status(version_id: str, status: DatasetStatus) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE synthetic_versions SET status = %s WHERE id = %s",
            (status.value, version_id),
        )
        conn.commit()


def delete_version(version_id: str) -> bool:
    """Delete a version; records / relationships / documents / reports / reviews
    cascade via their foreign keys."""
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM synthetic_versions WHERE id = %s", (version_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        return deleted


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


def _row_to_record(d: dict) -> SyntheticRecord:
    return SyntheticRecord(
        id=d["id"],
        project_id=d["project_id"],
        version_id=d.get("version_id"),
        element_type=ElementType(d["element_type"]),
        label=d["label"],
        text=d["text"],
        rationale=d.get("rationale", ""),
        industry=d.get("industry", "General"),
        doc_type=DocumentType(d.get("doc_type", "Contract")),
        language=d.get("language", "en"),
        risk_category=d.get("risk_category"),
        clause_structure=d.get("clause_structure"),
        status=RecordStatus(d.get("status", "candidate")),
        attributes=d.get("attributes") or {},
        provenance=d.get("provenance") or {},
        embedding_id=d.get("embedding_id"),
        created_at=d.get("created_at"),
    )


def insert_records(records: List[SyntheticRecord]) -> None:
    if not records:
        return
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO synthetic_records
               (id, project_id, version_id, element_type, label, text, rationale, industry,
                doc_type, language, risk_category, clause_structure, status, attributes,
                provenance, embedding_id)
               VALUES %s
               ON CONFLICT (id) DO UPDATE SET
                 status = EXCLUDED.status, version_id = EXCLUDED.version_id,
                 embedding_id = EXCLUDED.embedding_id""",
            [
                (
                    r.id, r.project_id, r.version_id, r.element_type.value, r.label,
                    r.text, r.rationale, r.industry, r.doc_type.value, r.language,
                    r.risk_category, r.clause_structure, r.status.value,
                    json.dumps(r.attributes), json.dumps(r.provenance), r.embedding_id,
                )
                for r in records
            ],
        )
        conn.commit()


def update_record_status(record_id: str, status: RecordStatus) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE synthetic_records SET status = %s WHERE id = %s",
            (status.value, record_id),
        )
        conn.commit()


def update_record_content(
    record_id: str, text: Optional[str] = None,
    label: Optional[str] = None, status: Optional[RecordStatus] = None,
) -> None:
    """Apply an SME edit / relabel / status change to a single record."""
    _ensure_init()
    sets, params = [], []
    if text is not None:
        sets.append("text = %s"); params.append(text)
    if label is not None:
        sets.append("label = %s"); params.append(label)
    if status is not None:
        sets.append("status = %s"); params.append(status.value)
    if not sets:
        return
    params.append(record_id)
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE synthetic_records SET {', '.join(sets)} WHERE id = %s", params)
        conn.commit()


def set_record_embedding(record_id: str, embedding_id: int) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE synthetic_records SET embedding_id = %s WHERE id = %s",
            (embedding_id, record_id),
        )
        conn.commit()


def get_record(record_id: str) -> Optional[SyntheticRecord]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_records WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return _row_to_record(dict(row)) if row else None


def list_records(version_id: str, status: Optional[RecordStatus] = None) -> List[SyntheticRecord]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if status:
            cur.execute(
                "SELECT * FROM synthetic_records WHERE version_id = %s AND status = %s ORDER BY created_at",
                (version_id, status.value),
            )
        else:
            cur.execute(
                "SELECT * FROM synthetic_records WHERE version_id = %s ORDER BY created_at",
                (version_id,),
            )
        return [_row_to_record(dict(r)) for r in cur.fetchall()]


def list_project_records(
    project_id: str, statuses: Optional[List[RecordStatus]] = None
) -> List[SyntheticRecord]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if statuses:
            cur.execute(
                "SELECT * FROM synthetic_records WHERE project_id = %s AND status = ANY(%s)",
                (project_id, [s.value for s in statuses]),
            )
        else:
            cur.execute("SELECT * FROM synthetic_records WHERE project_id = %s", (project_id,))
        return [_row_to_record(dict(r)) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Relationships + documents
# ---------------------------------------------------------------------------


def insert_relationships(rels: List[SyntheticRelationship]) -> None:
    if not rels:
        return
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO synthetic_relationships
               (id, project_id, version_id, source_record_id, target_record_id, rel_type,
                coverage_label, is_positive, rationale, status, attributes, provenance)
               VALUES %s ON CONFLICT (id) DO NOTHING""",
            [
                (
                    r.id, r.project_id, r.version_id, r.source_record_id, r.target_record_id,
                    r.rel_type.value, r.coverage_label.value if r.coverage_label else None,
                    r.is_positive, r.rationale, r.status.value,
                    json.dumps(r.attributes), json.dumps(r.provenance),
                )
                for r in rels
            ],
        )
        conn.commit()


def _row_to_relationship(d: dict) -> SyntheticRelationship:
    return SyntheticRelationship(
        id=d["id"], project_id=d["project_id"], version_id=d.get("version_id"),
        source_record_id=d["source_record_id"], target_record_id=d["target_record_id"],
        rel_type=RelationshipType(d["rel_type"]),
        coverage_label=CoverageStatus(d["coverage_label"]) if d.get("coverage_label") else None,
        is_positive=d.get("is_positive", True), rationale=d.get("rationale", ""),
        status=RecordStatus(d.get("status", "candidate")),
        attributes=d.get("attributes") or {}, provenance=d.get("provenance") or {},
        created_at=d.get("created_at"),
    )


def list_relationships(version_id: str) -> List[SyntheticRelationship]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_relationships WHERE version_id = %s", (version_id,))
        return [_row_to_relationship(dict(r)) for r in cur.fetchall()]


def update_relationship_status(rel_id: str, status: RecordStatus) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE synthetic_relationships SET status = %s WHERE id = %s",
            (status.value, rel_id),
        )
        conn.commit()


def insert_document(doc: SyntheticDocument) -> None:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO synthetic_documents
               (id, project_id, version_id, doc_type, title, member_record_ids, sections,
                artifact_uri, status, provenance)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (
                doc.id, doc.project_id, doc.version_id, doc.doc_type.value, doc.title,
                json.dumps(doc.member_record_ids), json.dumps(doc.sections),
                doc.artifact_uri, doc.status.value, json.dumps(doc.provenance),
            ),
        )
        conn.commit()


def list_documents(version_id: str) -> List[SyntheticDocument]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM synthetic_documents WHERE version_id = %s", (version_id,))
        out: List[SyntheticDocument] = []
        for r in cur.fetchall():
            d = dict(r)
            out.append(SyntheticDocument(
                id=d["id"], project_id=d["project_id"], version_id=d.get("version_id"),
                doc_type=DocumentType(d["doc_type"]), title=d["title"],
                member_record_ids=d.get("member_record_ids") or [],
                sections=d.get("sections") or [], artifact_uri=d.get("artifact_uri", ""),
                status=RecordStatus(d.get("status", "staged")),
                provenance=d.get("provenance") or {}, created_at=d.get("created_at"),
            ))
        return out


# ---------------------------------------------------------------------------
# Validation + quality reports
# ---------------------------------------------------------------------------


def upsert_validation_reports(reports: List[ValidationReport]) -> None:
    if not reports:
        return
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO synthetic_validation_reports (record_id, schema_ok, label_ok, rules_ok, reasons)
               VALUES %s ON CONFLICT (record_id) DO UPDATE SET
                 schema_ok = EXCLUDED.schema_ok, label_ok = EXCLUDED.label_ok,
                 rules_ok = EXCLUDED.rules_ok, reasons = EXCLUDED.reasons""",
            [(r.record_id, r.schema_ok, r.label_ok, r.rules_ok, json.dumps(r.reasons)) for r in reports],
        )
        conn.commit()


def upsert_quality_reports(reports: List[QualityReport]) -> None:
    if not reports:
        return
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO synthetic_quality_reports
               (record_id, realism, is_duplicate, duplicate_of, near_dup_score, realism_notes)
               VALUES %s ON CONFLICT (record_id) DO UPDATE SET
                 realism = EXCLUDED.realism, is_duplicate = EXCLUDED.is_duplicate,
                 duplicate_of = EXCLUDED.duplicate_of, near_dup_score = EXCLUDED.near_dup_score,
                 realism_notes = EXCLUDED.realism_notes""",
            [
                (r.record_id, r.realism, r.is_duplicate, r.duplicate_of, r.near_dup_score, r.realism_notes)
                for r in reports
            ],
        )
        conn.commit()


def get_reports_for_version(version_id: str) -> Dict[str, dict]:
    """Return {record_id: {validation:..., quality:...}} for a version."""
    _ensure_init()
    out: Dict[str, dict] = {}
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT v.* FROM synthetic_validation_reports v
               JOIN synthetic_records r ON r.id = v.record_id WHERE r.version_id = %s""",
            (version_id,),
        )
        for row in cur.fetchall():
            d = dict(row)
            out.setdefault(d["record_id"], {})["validation"] = d
        cur.execute(
            """SELECT q.* FROM synthetic_quality_reports q
               JOIN synthetic_records r ON r.id = q.record_id WHERE r.version_id = %s""",
            (version_id,),
        )
        for row in cur.fetchall():
            d = dict(row)
            out.setdefault(d["record_id"], {})["quality"] = d
    return out


# ---------------------------------------------------------------------------
# SME reviews
# ---------------------------------------------------------------------------


def add_sme_review(
    record_id: str, verdict: SMEVerdict, reviewer: str = "sme",
    corrected_label: Optional[str] = None, corrected_text: Optional[str] = None,
    comment: str = "",
) -> SMEReviewRow:
    _ensure_init()
    rid = str(uuid.uuid4())
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """INSERT INTO synthetic_sme_reviews
               (id, record_id, reviewer, verdict, corrected_label, corrected_text, comment)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (rid, record_id, reviewer, verdict.value, corrected_label, corrected_text, comment),
        )
        row = cur.fetchone()
        conn.commit()
        return SMEReviewRow(**dict(row))


def list_sme_reviews(version_id: str) -> List[SMEReviewRow]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT s.* FROM synthetic_sme_reviews s
               JOIN synthetic_records r ON r.id = s.record_id
               WHERE r.version_id = %s ORDER BY s.created_at""",
            (version_id,),
        )
        return [SMEReviewRow(**dict(r)) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Lineage
# ---------------------------------------------------------------------------


def add_lineage_edges(project_id: str, edges: List[tuple]) -> None:
    """edges: list of (from_node, to_node, edge_type)."""
    if not edges:
        return
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO synthetic_lineage (id, project_id, from_node, to_node, edge_type) VALUES %s",
            [(str(uuid.uuid4()), project_id, f, t, et) for (f, t, et) in edges],
        )
        conn.commit()


def list_lineage(project_id: str) -> List[dict]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT from_node, to_node, edge_type, created_at FROM synthetic_lineage "
            "WHERE project_id = %s ORDER BY created_at",
            (project_id,),
        )
        return [
            {
                "from": r["from_node"], "to": r["to_node"], "type": r["edge_type"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in cur.fetchall()
        ]
