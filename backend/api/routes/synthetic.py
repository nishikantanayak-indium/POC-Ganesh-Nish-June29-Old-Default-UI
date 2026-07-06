"""
Synthetic Data Studio API — prefix ``/api/studio``.

Endpoints group by the four core services:
  * projects + seeds + overview  (gap analysis)
  * generate (SSE)               (Generation → Validation → Quality → stage)
  * versions / records / reports (Validation + Quality surfaces)
  * sme                          (SME Review)
  * promote / publish / lineage  (Dataset Management)
"""
from __future__ import annotations

import asyncio
import json
import logging
import queue as _queue
from collections import Counter
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from api.deps import (
    get_dataset_service, get_doc_service, get_generation_service, get_sme_service,
)
from core.models import DocumentType, ElementType
from synthetic import db
from synthetic import taxonomy
from synthetic.models import MatrixCell, RecordStatus, SMEVerdict, VersionImmutableError
from synthetic.schemas import record_json_schema, relationship_json_schema

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/studio")


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ---------------------------------------------------------------------------
# Metadata (taxonomy + matrix + schemas) — powers the UI
# ---------------------------------------------------------------------------


@router.get("/meta")
async def meta() -> dict:
    from config.settings import settings
    return {
        "element_types": [e.value for e in ElementType],
        "labels": list(taxonomy.DEFAULT_LABELS),          # default set; projects override
        "doc_types": [d.value for d in DocumentType],
        "industries": taxonomy.DEFAULT_INDUSTRIES,
        "languages": taxonomy.DEFAULT_LANGUAGES,
        "all_cells": [c.to_dict() for c in taxonomy.all_cells()],
        "recommended_cells": [c.key for c in taxonomy.recommended_cells()],
        "min_threshold": settings.synthetic_min_threshold,
        "label_descriptions": dict(taxonomy.TAXONOMY_DESCRIPTIONS),
        "record_schema": record_json_schema(),
        "relationship_schema": relationship_json_schema(),
    }


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    min_threshold: Optional[int] = None
    labels: Optional[List[str]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    min_threshold: Optional[int] = None
    labels: Optional[List[str]] = None


@router.get("/projects")
async def list_projects() -> dict:
    projects = await asyncio.to_thread(db.list_projects)
    return {"projects": [p.to_dict() for p in projects]}


@router.post("/projects")
async def create_project(body: ProjectCreate) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    p = await asyncio.to_thread(
        db.create_project, body.name, body.description, body.min_threshold, body.labels,
    )
    return p.to_dict()


@router.get("/projects/{project_id}")
async def get_project(project_id: str) -> dict:
    p = await asyncio.to_thread(db.get_project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p.to_dict()


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate) -> dict:
    p = await asyncio.to_thread(
        db.update_project, project_id, body.name, body.description, body.min_threshold, body.labels,
    )
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p.to_dict()


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str) -> dict:
    deleted = await asyncio.to_thread(db.delete_project, project_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Seeds + overview (gap analysis)
# ---------------------------------------------------------------------------


def _build_overview(project) -> dict:
    """Merge seed counts with staged counts into the full matrix + gap flags."""
    seed = project.seed_summary or {}
    seed_counts = seed.get("counts", {})

    # Include already-staged/approved synthetic records so the overview reflects
    # everything available for this project, not just seeds.
    staged = db.list_project_records(project.id, statuses=[
        RecordStatus.STAGED, RecordStatus.SME_APPROVED, RecordStatus.PUBLISHED,
    ])
    staged_counts = Counter(r.cell.key for r in staged)

    labels = project.label_set
    recommended = {c.key for c in taxonomy.recommended_cells(labels)}
    cells = []
    under = []
    for cell in taxonomy.all_cells(labels):
        s = int(seed_counts.get(cell.key, 0))
        g = int(staged_counts.get(cell.key, 0))
        total = s + g
        deficit = max(0, project.min_threshold - total)
        if deficit > 0:
            under.append(cell.key)
        cells.append({
            "cell": cell.key,
            "element_type": cell.element_type.value,
            "label": cell.label,
            "seed_count": s,
            "generated_count": g,
            "total": total,
            "deficit": deficit,
            "sufficient": deficit == 0,
            "recommended": cell in recommended,
        })
    # AI-suggested labels not already in the project's set.
    suggested = [l for l in seed.get("suggested_labels", []) if l not in labels]

    return {
        "project_id": project.id,
        "min_threshold": project.min_threshold,
        "labels": labels,
        "suggested_labels": suggested,
        "cells": cells,
        "under_threshold": under,
        "seed_documents": seed.get("documents", []),
    }


@router.post("/projects/{project_id}/seeds")
async def upload_seeds(project_id: str, files: List[UploadFile] = File(...)) -> dict:
    project = await asyncio.to_thread(db.get_project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    doc_svc = get_doc_service()
    gen = get_generation_service()

    file_data = [(await f.read(), f.filename or "seed") for f in files]

    def _work() -> dict:
        counts: Counter = Counter()
        examples: dict = {}
        docs_meta = []
        parsed: list = []          # (doc, elements) kept so we can build per-doc structure
        all_elements = []
        for fb, fn in file_data:
            try:
                doc, elements = doc_svc.process_file(fb, fn)
            except Exception as exc:
                logger.warning("Seed parse failed for %s: %s", fn, exc)
                docs_meta.append({"name": fn, "elements": 0, "error": str(exc)})
                continue
            parsed.append((doc, elements))
            all_elements.extend(elements)

        labels = gen.classify_elements(all_elements, project.label_set)

        # Pooled counts + few-shot examples (used when not mirroring a doc).
        for el in all_elements:
            lbl = labels.get(el.id)
            if lbl is None:
                continue
            cell = MatrixCell(el.type, lbl)
            counts[cell.key] += 1
            examples.setdefault(cell.key, [])
            if len(examples[cell.key]) < 3:
                examples[cell.key].append(el.text[:300])

        # Per-document structure so a specific doc can be *mirrored*:
        # its per-cell composition, ordered section headings, and per-cell examples.
        for doc, elements in parsed:
            dcells: Counter = Counter()
            dexamples: dict = {}
            section_order: list = []
            section_cells: dict = {}
            for el in elements:
                lbl = labels.get(el.id)
                if lbl is None:
                    continue
                ck = MatrixCell(el.type, lbl).key
                dcells[ck] += 1
                dexamples.setdefault(ck, [])
                if len(dexamples[ck]) < 3:
                    dexamples[ck].append(el.text[:300])
                sec = str(el.metadata.get("section") or "General")
                if sec not in section_cells:
                    section_cells[sec] = Counter()
                    section_order.append(sec)
                section_cells[sec][ck] += 1
            docs_meta.append({
                "id": doc.id, "name": doc.name, "type": doc.type.value,
                "elements": len(elements), "cells": dict(dcells), "examples": dexamples,
                "sections": [{"heading": s, "cells": dict(section_cells[s])} for s in section_order],
            })

        # AI-suggested taxonomy derived from the seed content (advisory).
        suggested = gen.suggest_labels(all_elements, project.label_set)

        summary = {
            "counts": dict(counts), "examples": examples, "documents": docs_meta,
            "suggested_labels": suggested,
        }
        db.update_project_seed_summary(project_id, summary)
        return summary

    await asyncio.to_thread(_work)
    project = await asyncio.to_thread(db.get_project, project_id)
    return _build_overview(project)


@router.get("/projects/{project_id}/overview")
async def overview(project_id: str) -> dict:
    project = await asyncio.to_thread(db.get_project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await asyncio.to_thread(_build_overview, project)


@router.get("/projects/{project_id}/doc-overview")
async def doc_overview(project_id: str) -> dict:
    """Doc-type-keyed gap analysis — the document-first counterpart to
    ``overview`` above (which is the parked ElementType×Label matrix)."""
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.doc_type_overview, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ---------------------------------------------------------------------------
# Generate (SSE)
# ---------------------------------------------------------------------------


class GenerateBody(BaseModel):
    selections: List[dict]          # [{"cell": "Clause|Legal", "count": 5}]
    knobs: dict = {}


async def _stream_generate(project_id: str, body: GenerateBody) -> AsyncGenerator[str, None]:
    ds = get_dataset_service()
    progress_q: _queue.SimpleQueue = _queue.SimpleQueue()

    def _cb(evt: dict) -> None:
        progress_q.put(evt)

    def _run() -> dict:
        return ds.run_generation(project_id, body.selections, body.knobs, progress_cb=_cb)

    task = asyncio.create_task(asyncio.to_thread(_run))
    yield _sse({"stage": "queued", "message": "Generation started"})

    while not task.done():
        await asyncio.sleep(0.25)
        while not progress_q.empty():
            yield _sse(progress_q.get_nowait())
    # final drain
    while not progress_q.empty():
        yield _sse(progress_q.get_nowait())

    try:
        summary = await task
        yield _sse({"stage": "done", "summary": summary})
    except Exception as exc:
        logger.exception("Generation failed")
        yield _sse({"stage": "error", "message": str(exc)})


@router.post("/projects/{project_id}/generate")
async def generate(project_id: str, body: GenerateBody) -> StreamingResponse:
    return StreamingResponse(
        _stream_generate(project_id, body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ---------------------------------------------------------------------------
# Generate whole documents (SSE) — document-first pivot
# ---------------------------------------------------------------------------


class DocGenerateBody(BaseModel):
    doc_targets: List[dict]   # [{"doc_type": "RFP", "count": 5, "brief": "..."}]
    knobs: dict = {}


async def _stream_generate_documents(project_id: str, body: DocGenerateBody) -> AsyncGenerator[str, None]:
    ds = get_dataset_service()
    progress_q: _queue.SimpleQueue = _queue.SimpleQueue()

    def _cb(evt: dict) -> None:
        progress_q.put(evt)

    def _run() -> dict:
        return ds.run_document_generation(project_id, body.doc_targets, body.knobs, progress_cb=_cb)

    task = asyncio.create_task(asyncio.to_thread(_run))
    yield _sse({"stage": "queued", "message": "Generation started"})

    while not task.done():
        await asyncio.sleep(0.25)
        while not progress_q.empty():
            yield _sse(progress_q.get_nowait())
    while not progress_q.empty():
        yield _sse(progress_q.get_nowait())

    try:
        summary = await task
        yield _sse({"stage": "done", "summary": summary})
    except Exception as exc:
        logger.exception("Document generation failed")
        yield _sse({"stage": "error", "message": str(exc)})


@router.post("/projects/{project_id}/generate-documents")
async def generate_documents(project_id: str, body: DocGenerateBody) -> StreamingResponse:
    return StreamingResponse(
        _stream_generate_documents(project_id, body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ---------------------------------------------------------------------------
# Versions / records / reports
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/versions")
async def list_versions(project_id: str) -> dict:
    versions = await asyncio.to_thread(db.list_versions, project_id)
    counts = await asyncio.to_thread(db.version_status_counts, project_id)
    return {"versions": [{**v.to_dict(), "status_counts": counts.get(v.id, {})} for v in versions]}


@router.get("/versions/{version_id}/records")
async def list_records(version_id: str, status: Optional[str] = None) -> dict:
    st = RecordStatus(status) if status else None
    records = await asyncio.to_thread(db.list_records, version_id, st)
    return {"records": [r.to_dict() for r in records]}


@router.get("/versions/{version_id}/relationships")
async def list_relationships(version_id: str) -> dict:
    rels = await asyncio.to_thread(db.list_relationships, version_id)
    return {"relationships": [r.to_dict() for r in rels]}


@router.get("/versions/{version_id}/documents")
async def list_documents(version_id: str) -> dict:
    docs = await asyncio.to_thread(db.list_documents, version_id)
    return {"documents": [d.to_dict() for d in docs]}


@router.get("/versions/{version_id}/reports")
async def reports(version_id: str) -> dict:
    data = await asyncio.to_thread(db.get_reports_for_version, version_id)
    return {"reports": data}


@router.get("/versions/{version_id}/distribution")
async def distribution(version_id: str) -> dict:
    v = await asyncio.to_thread(db.get_version, version_id)
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return {"version_id": version_id, "stats": v.stats or {}}


# ---------------------------------------------------------------------------
# SME review
# ---------------------------------------------------------------------------


class VerdictBody(BaseModel):
    record_id: str
    verdict: str
    corrected_label: Optional[str] = None
    corrected_text: Optional[str] = None
    comment: str = ""
    reviewer: str = "sme"


@router.get("/versions/{version_id}/sme/sample")
async def sme_sample(version_id: str) -> dict:
    sme = get_sme_service()
    records = await asyncio.to_thread(sme.sample, version_id)
    reports = await asyncio.to_thread(db.get_reports_for_version, version_id)
    return {
        "sample": [r.to_dict() for r in records],
        "reports": {r.id: reports.get(r.id, {}) for r in records},
    }


@router.post("/versions/{version_id}/sme/verdict")
async def sme_verdict(version_id: str, body: VerdictBody) -> dict:
    sme = get_sme_service()
    try:
        verdict = SMEVerdict(body.verdict)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid verdict '{body.verdict}'")
    try:
        result = await asyncio.to_thread(
            sme.submit_verdict, body.record_id, verdict, body.reviewer,
            body.corrected_label, body.corrected_text, body.comment,
        )
    except VersionImmutableError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


@router.get("/versions/{version_id}/sme/summary")
async def sme_summary(version_id: str) -> dict:
    sme = get_sme_service()
    return await asyncio.to_thread(sme.summary, version_id)


@router.get("/versions/{version_id}/sme/queue")
async def sme_queue(version_id: str) -> dict:
    """Full review queue: every record + its report + review status, plus the
    IDs that make up the representative sample and the summary. The UI filters
    client-side (unreviewed / approved / rejected / all), so reviewed records
    stay visible instead of vanishing from a shrinking sample."""
    sme = get_sme_service()
    records = await asyncio.to_thread(db.list_records, version_id)
    reports = await asyncio.to_thread(db.get_reports_for_version, version_id)
    sample = await asyncio.to_thread(sme.sample, version_id)
    summary = await asyncio.to_thread(sme.summary, version_id)
    return {
        "records": [r.to_dict() for r in records],
        "reports": {r.id: reports.get(r.id, {}) for r in records},
        "sample_ids": [r.id for r in sample],
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# SME review — whole documents (document-first pivot)
# ---------------------------------------------------------------------------


class DocVerdictBody(BaseModel):
    document_id: str
    verdict: str
    corrected_markdown: Optional[str] = None
    corrected_title: Optional[str] = None
    comment: str = ""
    reviewer: str = "sme"


@router.get("/versions/{version_id}/sme/documents/queue")
async def sme_documents_queue(version_id: str) -> dict:
    sme = get_sme_service()
    docs = await asyncio.to_thread(db.list_documents, version_id)
    summary = await asyncio.to_thread(sme.document_summary, version_id)
    return {"documents": [d.to_dict() for d in docs], "summary": summary}


@router.post("/versions/{version_id}/sme/documents/verdict")
async def sme_documents_verdict(version_id: str, body: DocVerdictBody) -> dict:
    sme = get_sme_service()
    try:
        verdict = SMEVerdict(body.verdict)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid verdict '{body.verdict}'")
    try:
        return await asyncio.to_thread(
            sme.submit_document_verdict, body.document_id, verdict, body.reviewer,
            body.corrected_markdown, body.corrected_title, body.comment,
        )
    except VersionImmutableError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/versions/{version_id}/sme/documents/summary")
async def sme_documents_summary(version_id: str) -> dict:
    sme = get_sme_service()
    return await asyncio.to_thread(sme.document_summary, version_id)


# ---------------------------------------------------------------------------
# Promote / publish / lineage
# ---------------------------------------------------------------------------


class PublishBody(BaseModel):
    workspace_id: str


@router.post("/versions/{version_id}/promote")
async def promote(version_id: str) -> dict:
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.promote, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/versions/{version_id}/clone")
async def clone(version_id: str) -> dict:
    """Deep-copy a (frozen/main) version into a new editable staging version."""
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.clone_version, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/versions/{version_id}")
async def delete_version(version_id: str) -> dict:
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.delete_version, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ── Export ──────────────────────────────────────────────────────────────────

def _attach(content, filename: str, media_type: str) -> Response:
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/versions/{version_id}/export/records.jsonl")
async def export_records(version_id: str) -> Response:
    ds = get_dataset_service()
    data = await asyncio.to_thread(ds.export_records_jsonl, version_id)
    return _attach(data, f"{version_id[:8]}-records.jsonl", "application/x-ndjson")


@router.get("/versions/{version_id}/export/relationships.jsonl")
async def export_relationships(version_id: str) -> Response:
    ds = get_dataset_service()
    data = await asyncio.to_thread(ds.export_relationships_jsonl, version_id)
    return _attach(data, f"{version_id[:8]}-relationships.jsonl", "application/x-ndjson")


@router.get("/versions/{version_id}/export/bundle.zip")
async def export_bundle(version_id: str) -> Response:
    ds = get_dataset_service()
    try:
        data = await asyncio.to_thread(ds.export_bundle_zip, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _attach(data, f"{version_id[:8]}-bundle.zip", "application/zip")


@router.get("/versions/{version_id}/documents/{doc_id}/export.md")
async def export_doc_md(version_id: str, doc_id: str) -> Response:
    ds = get_dataset_service()
    try:
        data = await asyncio.to_thread(ds.document_markdown, version_id, doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _attach(data, f"{doc_id}.md", "text/markdown")


@router.get("/versions/{version_id}/documents/{doc_id}/export.docx")
async def export_doc_docx(version_id: str, doc_id: str) -> Response:
    ds = get_dataset_service()
    try:
        data = await asyncio.to_thread(ds.document_docx, version_id, doc_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _attach(
        data, f"{doc_id}.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.post("/versions/{version_id}/publish")
async def publish(version_id: str, body: PublishBody) -> dict:
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.publish_to_analysis, version_id, body.workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/versions/{version_id}/publish-to-store")
async def publish_to_store(version_id: str) -> dict:
    """Push SME-approved documents into the shared, cross-workspace document
    store (tagged `_gen`) — the document-first counterpart to ``publish``
    above. Does not touch any specific Analysis workspace; workspaces pull
    from the store on demand via ``POST /api/workspaces/{id}/import-synthetic/{doc_id}``."""
    ds = get_dataset_service()
    try:
        return await asyncio.to_thread(ds.publish_documents_to_store, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/projects/{project_id}/lineage")
async def lineage(project_id: str) -> dict:
    ds = get_dataset_service()
    return await asyncio.to_thread(ds.lineage, project_id)


# ---------------------------------------------------------------------------
# Shared document store (cross-workspace, browsable from any Analysis workspace)
# ---------------------------------------------------------------------------


@router.get("/store/documents")
async def store_documents(doc_type: Optional[str] = None) -> dict:
    docs = await asyncio.to_thread(db.list_store_documents, doc_type)
    return {"documents": [d.to_dict() for d in docs]}
