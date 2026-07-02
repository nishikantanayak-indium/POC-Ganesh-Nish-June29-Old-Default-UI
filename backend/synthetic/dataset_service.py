"""
Synthetic Dataset Management Service — the orchestrator (core #4).

Responsibilities:
  * run the generate → validate → quality → stage pipeline (with a bounded
    regeneration loop for records that fail validation),
  * generate relationship examples + assemble composite documents,
  * snapshot artifacts to the object store and record version stats,
  * maintain lineage,
  * promote a version staging → main,
  * publish a main version into an Analysis workspace (feeding the existing
    knowledge-graph pipeline unchanged).

``run_generation`` is a plain synchronous method driven by a ``progress_cb``
so the API layer can stream progress over SSE (mirroring the Analysis
pipeline route). Keeping orchestration here (not in the route) keeps it
testable and easy to evolve.
"""
from __future__ import annotations

import json
import logging
from typing import Callable, Dict, List, Optional

from core.models import (
    AtomicElement,
    DocumentType,
    ParsedDocument,
    Relationship,
)

from . import db
from .generation_service import SyntheticDataGenerationService
from .models import (
    DatasetStatus,
    MatrixCell,
    RecordStatus,
    SyntheticDocument,
    SyntheticRecord,
    SyntheticRelationship,
)
from .quality_service import SyntheticDataQualityAssessmentService
from .storage import get_artifact_store
from .validation_service import SyntheticDataValidationService

logger = logging.getLogger(__name__)

ProgressCB = Callable[[dict], None]


def _noop(_: dict) -> None:  # pragma: no cover
    pass


class SyntheticDatasetManagementService:
    def __init__(
        self,
        generation: SyntheticDataGenerationService,
        validation: SyntheticDataValidationService,
        quality: SyntheticDataQualityAssessmentService,
    ) -> None:
        self.gen = generation
        self.val = validation
        self.qual = quality
        self.store = get_artifact_store()

    # ==================================================================
    # Generation pipeline
    # ==================================================================

    def run_generation(
        self,
        project_id: str,
        selections: List[dict],           # [{"cell": "Clause|Legal", "count": 5}, ...]
        knobs: Optional[dict] = None,
        progress_cb: ProgressCB = _noop,
    ) -> dict:
        knobs = knobs or {}
        project = db.get_project(project_id)
        if project is None:
            raise ValueError(f"project {project_id} not found")

        industries = knobs.get("industries")
        languages = knobs.get("languages")
        doc_types = [DocumentType(d) for d in knobs.get("doc_types", [])] or None
        do_relationships = knobs.get("generate_relationships", True)
        do_documents = knobs.get("assemble_documents", True)
        brief = knobs.get("brief") or ""
        mirror_document_id = knobs.get("mirror_document_id")
        max_regen = knobs.get("max_regen")
        from config.settings import settings
        if max_regen is None:
            max_regen = settings.synthetic_max_regen

        seed_examples: Dict[str, List[str]] = (project.seed_summary or {}).get("examples", {})

        # ── Mirror mode: reproduce a specific seed document's shape ──────────
        mirror_doc: Optional[dict] = None
        if mirror_document_id:
            for d in (project.seed_summary or {}).get("documents", []):
                if d.get("id") == mirror_document_id:
                    mirror_doc = d
                    break
            if mirror_doc:
                # Prefer the mirrored document's own examples for few-shot conditioning.
                if mirror_doc.get("examples"):
                    seed_examples = {**seed_examples, **mirror_doc["examples"]}
                # If the caller didn't specify selections, derive them from the doc's composition.
                if not selections and mirror_doc.get("cells"):
                    selections = [{"cell": k, "count": int(v)} for k, v in mirror_doc["cells"].items()]
                progress_cb({"stage": "start",
                             "message": f"Mirroring '{mirror_doc.get('name')}' — {len(selections)} cells"})

        dataset = db.get_or_create_default_dataset(project_id)
        version = db.create_version(project_id, dataset.id, note=knobs.get("note", ""))
        progress_cb({"stage": "start", "message": f"Version v{version.version_no} created",
                     "version_id": version.id})

        all_records: List[SyntheticRecord] = []
        all_reports = []  # ValidationReport
        total_target = sum(int(s["count"]) for s in selections)
        done = 0

        # ── generate + validate (+ bounded regeneration) per cell ────────
        for sel in selections:
            cell = MatrixCell.from_key(sel["cell"])
            count = int(sel["count"])
            if count <= 0:
                continue
            progress_cb({"stage": "generate", "message": f"Generating {count}× {cell.key}",
                         "current": done, "total": total_target, "cell": cell.key})

            passing: List[SyntheticRecord] = []
            attempts = 0
            need = count
            while need > 0 and attempts <= max_regen:
                batch = self.gen.generate_records(
                    project_id, cell, need, seeds=seed_examples.get(cell.key),
                    industries=industries, languages=languages, doc_types=doc_types,
                    version_id=version.id, brief=brief,
                )
                reports = self.val.validate_records(batch)
                rep_by_id = {r.record_id: r for r in reports}
                for rec in batch:
                    rep = rep_by_id[rec.id]
                    if rep.passed:
                        passing.append(rec)
                        all_reports.append(rep)
                    else:
                        rec.status = RecordStatus.REJECTED
                        all_records.append(rec)      # keep rejected for transparency
                        all_reports.append(rep)
                need = count - len(passing)
                attempts += 1
                if need > 0 and attempts <= max_regen:
                    progress_cb({"stage": "validate",
                                 "message": f"{cell.key}: {need} failed validation — regenerating (attempt {attempts})",
                                 "current": done, "total": total_target, "cell": cell.key})

            all_records.extend(passing)
            done += count
            progress_cb({"stage": "validate", "message": f"{cell.key}: {len(passing)} valid",
                         "current": done, "total": total_target, "cell": cell.key})

        valid_records = [r for r in all_records if r.status != RecordStatus.REJECTED]

        # ── quality assessment (dedup + realism) ─────────────────────────
        progress_cb({"stage": "quality", "message": f"Assessing quality of {len(valid_records)} records"})
        quality_reports = self.qual.assess_records(valid_records)
        qr_by_id = {q.record_id: q for q in quality_reports}
        staged: List[SyntheticRecord] = []
        for rec in valid_records:
            q = qr_by_id.get(rec.id)
            if q and q.passed:
                rec.status = RecordStatus.STAGED
                staged.append(rec)
            elif q and q.is_duplicate:
                rec.status = RecordStatus.DUPLICATE
            else:
                rec.status = RecordStatus.REJECTED
        progress_cb({"stage": "quality",
                     "message": f"{len(staged)} staged · "
                                f"{sum(1 for q in quality_reports if q.is_duplicate)} duplicates · "
                                f"{sum(1 for q in quality_reports if not q.passed and not q.is_duplicate)} low-realism"})

        # ── relationships ────────────────────────────────────────────────
        relationships: List[SyntheticRelationship] = []
        if do_relationships and staged:
            progress_cb({"stage": "relate", "message": "Generating relationship / mapping examples"})
            rels = self.gen.generate_relationships(project_id, staged, version_id=version.id)
            id_to_type = {r.id: r.element_type for r in staged}
            reasons = self.val.validate_relationships(rels, id_to_type)
            for rel in rels:
                if not reasons.get(rel.id):
                    rel.status = RecordStatus.STAGED
                    relationships.append(rel)
            progress_cb({"stage": "relate",
                         "message": f"{len(relationships)}/{len(rels)} relationships passed coverage consistency"})

        # ── composite documents ─────────────────────────────────────────
        documents: List[SyntheticDocument] = []
        if do_documents and staged:
            if mirror_doc:
                # Single document mirroring the source's type + section layout.
                progress_cb({"stage": "assemble",
                             "message": f"Assembling 1 document mirroring '{mirror_doc.get('name')}'"})
                try:
                    dtype = DocumentType(mirror_doc.get("type", staged[0].doc_type.value))
                except ValueError:
                    dtype = staged[0].doc_type
                doc, markdown = self.gen.assemble_document(
                    project_id, staged, dtype, version_id=version.id,
                    structure=mirror_doc.get("sections"), brief=brief,
                )
                key = self._doc_key(project_id, dataset.id, version.version_no, doc.id)
                doc.artifact_uri = self.store.put_text(key, markdown, "text/markdown")
                documents.append(doc)
            else:
                progress_cb({"stage": "assemble", "message": "Assembling composite documents"})
                by_doc: Dict[DocumentType, List[SyntheticRecord]] = {}
                for r in staged:
                    by_doc.setdefault(r.doc_type, []).append(r)
                for dtype, recs in by_doc.items():
                    doc, markdown = self.gen.assemble_document(
                        project_id, recs, dtype, version_id=version.id, brief=brief,
                    )
                    key = self._doc_key(project_id, dataset.id, version.version_no, doc.id)
                    doc.artifact_uri = self.store.put_text(key, markdown, "text/markdown")
                    documents.append(doc)

        # ── persist everything ───────────────────────────────────────────
        progress_cb({"stage": "persist", "message": "Persisting records, reports, artifacts"})
        db.insert_records(all_records)
        db.upsert_validation_reports(all_reports)
        db.upsert_quality_reports(quality_reports)
        db.insert_relationships(relationships)
        for d in documents:
            db.insert_document(d)

        # ── snapshot + stats + lineage ───────────────────────────────────
        distribution = self.qual.compute_distribution(staged, relationships, project.min_threshold)
        artifact_uri = self._snapshot(project_id, dataset.id, version.version_no,
                                      staged, relationships)
        stats = {
            "requested": total_target,
            "generated": len(all_records),
            "staged": len(staged),
            "rejected": sum(1 for r in all_records if r.status == RecordStatus.REJECTED),
            "duplicates": sum(1 for r in all_records if r.status == RecordStatus.DUPLICATE),
            "relationships": len(relationships),
            "documents": len(documents),
            "distribution": distribution,
        }
        db.update_version_stats(version.id, stats, artifact_uri)
        self._lineage_for_generation(project_id, version.id, selections, staged)
        db.touch_project(project_id)

        summary = {"version_id": version.id, "version_no": version.version_no, **stats}
        progress_cb({"stage": "complete", "message": "Generation complete", "summary": summary})
        return summary

    # ==================================================================
    # Promotion + publication
    # ==================================================================

    def promote(self, version_id: str) -> dict:
        version = db.get_version(version_id)
        if version is None:
            raise ValueError(f"version {version_id} not found")
        db.set_version_status(version_id, DatasetStatus.MAIN)
        db.add_lineage_edges(version.project_id, [
            (f"version:{version_id}", f"main:{version_id}", "promoted"),
        ])
        return {"version_id": version_id, "status": DatasetStatus.MAIN.value}

    def publish_to_analysis(
        self, version_id: str, workspace_id: str, progress_cb: ProgressCB = _noop,
    ) -> dict:
        """Convert accepted synthetic records into graph elements and ingest them
        into an Analysis workspace via the existing graph pipeline."""
        version = db.get_version(version_id)
        if version is None:
            raise ValueError(f"version {version_id} not found")

        # Publish everything accepted: SME-approved plus staged-but-unreviewed.
        # SME-rejected and duplicate records are excluded by virtue of their status.
        records = (
            db.list_records(version_id, status=RecordStatus.SME_APPROVED)
            + db.list_records(version_id, status=RecordStatus.STAGED)
        )
        if not records:
            raise ValueError("no accepted records to publish")

        progress_cb({"stage": "publish", "message": f"Publishing {len(records)} records to workspace"})

        # Group records into one synthetic ParsedDocument per doc_type.
        by_doc: Dict[DocumentType, List[SyntheticRecord]] = {}
        for r in records:
            by_doc.setdefault(r.doc_type, []).append(r)

        documents: List[ParsedDocument] = []
        elements: List[AtomicElement] = []
        rec_ids = {r.id for r in records}
        for dtype, recs in by_doc.items():
            doc_id = f"SYNDOC_{version_id[:8]}_{dtype.value}".replace(" ", "")
            body = "\n\n".join(r.text for r in recs)
            documents.append(ParsedDocument(
                id=doc_id, name=f"Synthetic {dtype.value} (v{version.version_no})",
                type=dtype, pages=[body], total_pages=1,
            ))
            for r in recs:
                el = AtomicElement(
                    id=r.id, type=r.element_type, text=r.text,
                    source=f"Synthetic {dtype.value} — {r.label.value}",
                    document_id=doc_id, confidence=1.0,
                    metadata={"section": r.label.value, "page_number": 1, "synthetic": True},
                )
                elements.append(el)

        # Relationships (positive only — negatives represent absence of an edge).
        relationships: List[Relationship] = []
        for rel in db.list_relationships(version_id):
            if not rel.is_positive:
                continue
            if rel.source_record_id in rec_ids and rel.target_record_id in rec_ids:
                relationships.append(Relationship(
                    source_id=rel.source_record_id, target_id=rel.target_record_id,
                    type=rel.rel_type, confidence=1.0, evidence=rel.rationale,
                ))

        # Lazy import to avoid an import cycle (deps → services → ...).
        from api.deps import get_graph_service
        gs = get_graph_service(workspace_id)
        doc_hashes = {d.id: f"synthetic-{version_id}-{d.id}" for d in documents}
        gs.build_knowledge_graph(documents, elements, relationships, doc_hashes)

        for r in records:
            db.update_record_content(r.id, status=RecordStatus.PUBLISHED)
        db.add_lineage_edges(version.project_id, [
            (f"version:{version_id}", f"workspace:{workspace_id}", "published"),
        ])

        summary = {
            "version_id": version_id, "workspace_id": workspace_id,
            "documents": len(documents), "elements": len(elements),
            "relationships": len(relationships),
            "nodes": gs.get_node_count(), "edges": gs.get_edge_count(),
        }
        progress_cb({"stage": "complete", "message": "Published to Analysis", "summary": summary})
        return summary

    # ==================================================================
    # Lineage + artifacts
    # ==================================================================

    def lineage(self, project_id: str) -> dict:
        return {"project_id": project_id, "edges": db.list_lineage(project_id)}

    def _snapshot(
        self, project_id: str, dataset_id: str, version_no: int,
        records: List[SyntheticRecord], relationships: List[SyntheticRelationship],
    ) -> str:
        base = f"{project_id}/{dataset_id}/v{version_no}"
        rec_jsonl = "\n".join(json.dumps(r.to_dict(), ensure_ascii=False) for r in records)
        uri = self.store.put_text(f"{base}/records.jsonl", rec_jsonl, "application/x-ndjson")
        rel_jsonl = "\n".join(json.dumps(r.to_dict(), ensure_ascii=False) for r in relationships)
        self.store.put_text(f"{base}/relationships.jsonl", rel_jsonl, "application/x-ndjson")
        return uri

    def _doc_key(self, project_id: str, dataset_id: str, version_no: int, doc_id: str) -> str:
        return f"{project_id}/{dataset_id}/v{version_no}/docs/{doc_id}.md"

    def _lineage_for_generation(
        self, project_id: str, version_id: str, selections: List[dict],
        staged: List[SyntheticRecord],
    ) -> None:
        edges = [(f"project:{project_id}", f"version:{version_id}", "generated")]
        for sel in selections:
            edges.append((f"version:{version_id}", f"cell:{sel['cell']}", "targets"))
        db.add_lineage_edges(project_id, edges)
