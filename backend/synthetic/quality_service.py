"""
Synthetic Data Quality Assessment Service.

  * Duplicate Detection — BGE-M3 embeddings compared by cosine similarity,
    against both the persistent Qdrant collection (already-accepted records)
    and the current batch (in-memory). Configurable exact/near thresholds.
  * Realism Score       — rule-based heuristics blended with LLM-as-Judge.
  * Diversity & Balance — distribution analysis across cells, labels, doc
    types, industries, languages, and positive/negative relationship split.
"""
from __future__ import annotations

import json
import logging
import math
import re
from collections import Counter
from typing import Dict, List, Optional

from openai import OpenAI

from config.settings import settings
from vector.embedder import BGEEmbedder

from .models import QualityReport, SyntheticRecord, SyntheticRelationship

logger = logging.getLogger(__name__)

_KEYWORDS = re.compile(
    r"\b(shall|must|will|liable|liability|penalty|indemnif|comply|warrant|terminate|"
    r"deliver|payment|invoice|breach|obligation|service level|uptime|damages)\b",
    re.IGNORECASE,
)
_PLACEHOLDER = re.compile(r"(lorem ipsum|todo|xxx|\[insert|placeholder|tbd)", re.IGNORECASE)

_JUDGE_TOOL = {
    "type": "function",
    "function": {
        "name": "judge_realism",
        "description": "Score how realistic each synthetic procurement record is.",
        "parameters": {
            "type": "object",
            "properties": {
                "scores": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "realism": {"type": "number", "minimum": 0, "maximum": 1},
                            "note": {"type": "string"},
                        },
                        "required": ["id", "realism"],
                    },
                }
            },
            "required": ["scores"],
        },
    },
}


def _hash_id(s: str) -> int:
    return abs(hash(s)) % (2 ** 63)


class _SyntheticVectorIndex:
    """Thin Qdrant wrapper for scored duplicate detection over synthetic records."""

    def __init__(self, embedder: BGEEmbedder) -> None:
        self._embedder = embedder
        self._collection = settings.synthetic_qdrant_collection
        self._client = None
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams
            self._client = QdrantClient(
                host=settings.qdrant_host, port=settings.qdrant_port,
                api_key=settings.qdrant_api_key or None,
            )
            existing = [c.name for c in self._client.get_collections().collections]
            if self._collection not in existing:
                self._client.create_collection(
                    collection_name=self._collection,
                    vectors_config=VectorParams(
                        size=settings.embedding_dimension, distance=Distance.COSINE
                    ),
                )
        except Exception as exc:  # pragma: no cover - infra dependent
            logger.warning("Synthetic Qdrant index unavailable (%s) — dedup falls back to in-batch only", exc)
            self._client = None

    def nearest(self, vector: List[float]) -> tuple[Optional[str], float]:
        if self._client is None:
            return None, 0.0
        try:
            resp = self._client.query_points(
                collection_name=self._collection, query=vector, limit=1, with_payload=True,
            )
            if resp.points:
                p = resp.points[0]
                return p.payload.get("record_id"), float(p.score)
        except Exception as exc:
            logger.debug("Qdrant nearest lookup failed: %s", exc)
        return None, 0.0

    def add(self, record_id: str, vector: List[float]) -> Optional[int]:
        if self._client is None:
            return None
        try:
            from qdrant_client.models import PointStruct
            pid = _hash_id(record_id)
            self._client.upsert(
                collection_name=self._collection,
                points=[PointStruct(id=pid, vector=vector, payload={"record_id": record_id})],
            )
            return pid
        except Exception as exc:
            logger.debug("Qdrant add failed: %s", exc)
            return None


class SyntheticDataQualityAssessmentService:
    """Core #3 — quality assessment."""

    def __init__(self, embedder: Optional[BGEEmbedder] = None) -> None:
        self._embedder = embedder or BGEEmbedder()
        self._index = _SyntheticVectorIndex(self._embedder)
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.llm_model

    # ------------------------------------------------------------------
    # Duplicate detection + realism
    # ------------------------------------------------------------------

    def assess_records(self, records: List[SyntheticRecord]) -> List[QualityReport]:
        """Return one QualityReport per record and index the non-duplicates."""
        if not records:
            return []

        vectors = self._embedder.embed([r.text for r in records])
        realism_llm = self._judge_realism(records)

        reports: List[QualityReport] = []
        batch_seen: List[tuple[str, List[float]]] = []  # (record_id, vector)

        for rec, vec in zip(records, vectors):
            # Nearest in persistent index
            dup_of, score = self._index.nearest(vec)
            # Nearest within this batch
            for prev_id, prev_vec in batch_seen:
                s = sum(a * b for a, b in zip(vec, prev_vec))
                if s > score:
                    score, dup_of = s, prev_id

            is_dup = score >= settings.synthetic_dup_near
            realism = self._blend_realism(rec, realism_llm.get(rec.id))

            reports.append(QualityReport(
                record_id=rec.id, realism=realism, is_duplicate=is_dup,
                duplicate_of=dup_of if is_dup else None, near_dup_score=score,
                realism_notes=realism_llm.get(rec.id, {}).get("note", ""),
            ))

            # Only non-duplicates join the reference set (in-batch + persistent).
            if not is_dup:
                batch_seen.append((rec.id, vec))
                pid = self._index.add(rec.id, vec)
                if pid is not None:
                    rec.embedding_id = pid
        return reports

    def _rule_realism(self, rec: SyntheticRecord) -> float:
        text = rec.text or ""
        score = 0.5
        if 40 <= len(text) <= 800:
            score += 0.2
        if _KEYWORDS.search(text):
            score += 0.15
        if not _PLACEHOLDER.search(text):
            score += 0.15
        return min(1.0, score)

    def _blend_realism(self, rec: SyntheticRecord, llm: Optional[dict]) -> float:
        rule = self._rule_realism(rec)
        if llm and "realism" in llm:
            return round(0.4 * rule + 0.6 * float(llm["realism"]), 3)
        return round(rule, 3)

    def _judge_realism(self, records: List[SyntheticRecord]) -> Dict[str, dict]:
        out: Dict[str, dict] = {}
        for i in range(0, len(records), 25):
            batch = records[i:i + 25]
            listing = "\n".join(f"{r.id} [{r.element_type.value}/{r.label.value}]: {r.text[:220]}" for r in batch)
            system = (
                "You are a procurement/legal SME acting as a realism judge. For each record, "
                "score 0-1 how closely it resembles a real-world contract artifact and follows "
                "legal drafting conventions (1=indistinguishable from real, 0=clearly fake or "
                "contradictory). Add a short note for low scores."
            )
            try:
                resp = self.client.chat.completions.create(
                    model=self.model, temperature=0,
                    messages=[{"role": "system", "content": system},
                              {"role": "user", "content": f"Score:\n{listing}"}],
                    tools=[_JUDGE_TOOL],
                    tool_choice={"type": "function", "function": {"name": "judge_realism"}},
                    max_tokens=2000,
                )
                tc = resp.choices[0].message.tool_calls
                if tc:
                    for s in json.loads(tc[0].function.arguments).get("scores", []):
                        out[s["id"]] = {"realism": s.get("realism", 0.5), "note": s.get("note", "")}
            except Exception as exc:
                logger.warning("Realism judge batch failed (%s) — using rule score only", exc)
        return out

    # ------------------------------------------------------------------
    # Diversity & balance
    # ------------------------------------------------------------------

    def compute_distribution(
        self, records: List[SyntheticRecord],
        relationships: Optional[List[SyntheticRelationship]] = None,
        min_threshold: Optional[int] = None,
    ) -> dict:
        """Distribution analysis + a normalised-entropy diversity score."""
        thr = min_threshold if min_threshold is not None else settings.synthetic_min_threshold

        by_cell = Counter(r.cell.key for r in records)
        by_label = Counter(r.label.value for r in records)
        by_type = Counter(r.element_type.value for r in records)
        by_doc = Counter(r.doc_type.value for r in records)
        by_industry = Counter(r.industry for r in records)
        by_language = Counter(r.language for r in records)

        under = [c for c, n in by_cell.items() if n < thr]
        # Over-represented: > 2× the mean cell count.
        mean = (sum(by_cell.values()) / len(by_cell)) if by_cell else 0
        over = [c for c, n in by_cell.items() if mean and n > 2 * mean]

        rel_stats = {}
        if relationships:
            rel_stats = {
                "by_type": dict(Counter(r.rel_type.value for r in relationships)),
                "positive": sum(1 for r in relationships if r.is_positive),
                "negative": sum(1 for r in relationships if not r.is_positive),
            }

        return {
            "total": len(records),
            "diversity_score": round(self._entropy_score(by_cell), 3),
            "balance_score": round(self._balance_score(by_cell), 3),
            "by_cell": dict(by_cell),
            "by_label": dict(by_label),
            "by_element_type": dict(by_type),
            "by_doc_type": dict(by_doc),
            "by_industry": dict(by_industry),
            "by_language": dict(by_language),
            "under_represented": under,
            "over_represented": over,
            "relationships": rel_stats,
        }

    @staticmethod
    def _entropy_score(counter: Counter) -> float:
        """Normalised Shannon entropy over cells (1 = perfectly diverse)."""
        total = sum(counter.values())
        if total == 0 or len(counter) <= 1:
            return 0.0
        probs = [c / total for c in counter.values()]
        h = -sum(p * math.log(p) for p in probs if p > 0)
        return h / math.log(len(counter))

    @staticmethod
    def _balance_score(counter: Counter) -> float:
        """1 - coefficient-of-variation-ish; 1 = evenly balanced."""
        if not counter:
            return 0.0
        vals = list(counter.values())
        mean = sum(vals) / len(vals)
        if mean == 0:
            return 0.0
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        cv = math.sqrt(var) / mean
        return max(0.0, 1.0 - cv)
