"""
SME Review Service.

Serves a statistically representative sample of staged records for manual
review, records SME verdicts (approve / reject / edit-relabel), and aggregates
feedback so it can be folded back into generation prompts and validation rules.

Sampling rule: stratified by matrix cell, ``min(N, max(3, ceil(sqrt(N))))``
per cell (deterministic — first-N by creation order — so a review is
reproducible). This gives small cells full coverage and large cells a
representative fraction.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Dict, List, Optional

from . import db
from .models import (
    DatasetStatus, RecordStatus, SMEVerdict, SyntheticDocument, SyntheticRecord, VersionImmutableError,
)
from .storage import get_artifact_store


class SMEReviewService:
    """SME sampling + verdict capture + feedback."""

    def __init__(self) -> None:
        self.store = get_artifact_store()

    def sample(self, version_id: str, per_cell_cap: int = 10) -> List[SyntheticRecord]:
        staged = db.list_records(version_id, status=RecordStatus.STAGED)
        by_cell: Dict[str, List[SyntheticRecord]] = defaultdict(list)
        for r in staged:
            by_cell[r.cell.key].append(r)

        sample: List[SyntheticRecord] = []
        for _, recs in sorted(by_cell.items()):
            n = len(recs)
            k = min(n, max(3, math.ceil(math.sqrt(n))), per_cell_cap)
            sample.extend(recs[:k])
        return sample

    def submit_verdict(
        self, record_id: str, verdict: SMEVerdict, reviewer: str = "sme",
        corrected_label: Optional[str] = None, corrected_text: Optional[str] = None,
        comment: str = "",
    ) -> dict:
        rec = db.get_record(record_id)
        if rec is None:
            raise ValueError(f"record {record_id} not found")

        # Main versions are immutable — reviews/edits are only allowed on staging.
        if rec.version_id:
            version = db.get_version(rec.version_id)
            if version and version.status == DatasetStatus.MAIN.value:
                raise VersionImmutableError(
                    "version is promoted to main and is immutable — clone it to make changes"
                )

        db.add_sme_review(
            record_id, verdict, reviewer=reviewer,
            corrected_label=corrected_label, corrected_text=corrected_text, comment=comment,
        )

        if verdict == SMEVerdict.APPROVE:
            db.update_record_content(record_id, status=RecordStatus.SME_APPROVED)
        elif verdict == SMEVerdict.REJECT:
            db.update_record_content(record_id, status=RecordStatus.SME_REJECTED)
        elif verdict == SMEVerdict.EDIT:
            db.update_record_content(
                record_id,
                text=corrected_text if corrected_text else None,
                label=corrected_label if corrected_label else None,
                status=RecordStatus.SME_APPROVED,  # an edited record is an accepted record
            )
        return {"record_id": record_id, "verdict": verdict.value}

    def summary(self, version_id: str) -> dict:
        reviews = db.list_sme_reviews(version_id)
        staged_plus = db.list_records(version_id)  # all records in the version
        total_reviewed = len({r.record_id for r in reviews})
        by_verdict = Counter(r.verdict for r in reviews)
        approved = by_verdict.get(SMEVerdict.APPROVE.value, 0) + by_verdict.get(SMEVerdict.EDIT.value, 0)
        rejected = by_verdict.get(SMEVerdict.REJECT.value, 0)
        denom = approved + rejected
        comments = [
            {"record_id": r.record_id, "verdict": r.verdict, "comment": r.comment}
            for r in reviews if r.comment.strip()
        ]
        reviewable = sum(1 for r in staged_plus if r.status in (
            RecordStatus.STAGED, RecordStatus.SME_APPROVED, RecordStatus.SME_REJECTED,
        ))
        return {
            "version_id": version_id,
            "reviewable": reviewable,
            "reviewed": total_reviewed,
            "by_verdict": dict(by_verdict),
            "approval_rate": round(approved / denom, 3) if denom else 0.0,
            "feedback": comments[:50],
            "complete": reviewable > 0 and total_reviewed >= reviewable,
        }

    # ==================================================================
    # Document-level review (document-first pivot)
    # ==================================================================

    def sample_documents(self, version_id: str) -> List[SyntheticDocument]:
        """Every staged document goes up for review — run sizes here are small
        (whole documents, not hundreds of atomic records), so unlike ``sample``
        there's no stratified sub-sampling."""
        return db.list_documents(version_id)

    def submit_document_verdict(
        self, document_id: str, verdict: SMEVerdict, reviewer: str = "sme",
        corrected_markdown: Optional[str] = None, corrected_title: Optional[str] = None,
        comment: str = "",
    ) -> dict:
        doc = db.get_document(document_id)
        if doc is None:
            raise ValueError(f"document {document_id} not found")

        version = db.get_version(doc.version_id) if doc.version_id else None
        if version and version.status == DatasetStatus.MAIN.value:
            raise VersionImmutableError(
                "version is promoted to main and is immutable — clone it to make changes"
            )

        db.add_document_review(
            document_id, verdict, reviewer=reviewer,
            corrected_title=corrected_title, comment=comment,
        )

        if verdict == SMEVerdict.APPROVE:
            db.update_document_content(document_id, status=RecordStatus.SME_APPROVED)
        elif verdict == SMEVerdict.REJECT:
            db.update_document_content(document_id, status=RecordStatus.SME_REJECTED)
        elif verdict == SMEVerdict.EDIT:
            artifact_uri = None
            if corrected_markdown is not None and version:
                key = doc.provenance.get("artifact_key") or \
                    f"{doc.project_id}/{version.dataset_id}/v{version.version_no}/docs/{doc.id}.md"
                artifact_uri = self.store.put_text(key, corrected_markdown, "text/markdown")
            db.update_document_content(
                document_id,
                title=corrected_title if corrected_title else None,
                status=RecordStatus.SME_APPROVED,  # an edited document is an accepted document
                artifact_uri=artifact_uri,
            )
        return {"document_id": document_id, "verdict": verdict.value}

    def document_summary(self, version_id: str) -> dict:
        reviews = db.list_document_reviews(version_id)
        docs = db.list_documents(version_id)
        total_reviewed = len({r.document_id for r in reviews})
        by_verdict = Counter(r.verdict for r in reviews)
        approved = by_verdict.get(SMEVerdict.APPROVE.value, 0) + by_verdict.get(SMEVerdict.EDIT.value, 0)
        rejected = by_verdict.get(SMEVerdict.REJECT.value, 0)
        denom = approved + rejected
        comments = [
            {"document_id": r.document_id, "verdict": r.verdict, "comment": r.comment}
            for r in reviews if r.comment.strip()
        ]
        reviewable = sum(1 for d in docs if d.status in (
            RecordStatus.STAGED, RecordStatus.SME_APPROVED, RecordStatus.SME_REJECTED,
        ))
        return {
            "version_id": version_id,
            "reviewable": reviewable,
            "reviewed": total_reviewed,
            "by_verdict": dict(by_verdict),
            "approval_rate": round(approved / denom, 3) if denom else 0.0,
            "feedback": comments[:50],
            "complete": reviewable > 0 and total_reviewed >= reviewable,
        }
