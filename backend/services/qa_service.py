"""
QA service: intent-aware, graph-augmented question-answering.

Architecture
------------
answer()
  1. _classify_intent()     — two-tier: keyword scoring → LLM fallback
  2. evidence gatherer      — one per intent (see routes below)
  3. _synthesize()          — GPT-4o with evidence JSON

Intent routes
~~~~~~~~~~~~~
coverage_gap     — requirements with no contract-clause coverage
risk_for_partial — risks linked to partially-covered requirements
no_mitigation    — risks with no MITIGATED_BY edge
no_ld            — risks with no LINKED_TO_LD edge
summary          — aggregate counts (coverage rate, risk status)
comparison       — cross-document comparison (wide search + explicit cross-doc edges)
general          — semantic vector + 2-hop graph expansion + Graphiti
"""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import OpenAI

from config.settings import settings
from core.models import (
    AtomicElement,
    CoverageStatus,
    ElementType,
    RelationshipType,
)
from graph.builder import GraphBuilder
from graph.neo4j_store import Neo4jGraphStore
from vector.qdrant_store import QdrantVectorStore

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent keyword scoring tables
# ---------------------------------------------------------------------------

_INTENT_KEYWORDS: dict[str, list[str]] = {
    "coverage_gap": [
        "not covered", "uncovered", "missing coverage", "no coverage", "gap",
        "not addressed", "not fulfilled", "without coverage", "no clause",
        "unaddressed", "not met", "coverage gap", "which requirements are not",
        "requirements without", "unfulfilled", "no matching clause",
    ],
    "risk_for_partial": [
        "risk partial", "partial coverage risk", "risks partial",
        "risk for partial", "partially covered requirement",
    ],
    "no_mitigation": [
        "no mitigation", "unmitigated", "without mitigation", "missing mitigation",
        "no control", "uncontrolled", "not mitigated", "lack mitigation",
        "risks without mitigation", "no remedy", "no risk control",
    ],
    "no_ld": [
        "no ld", "no liquidated", "without ld", "missing ld", "no penalty",
        "no damages", "no financial penalty", "without liquidated",
        "lacking ld", "no consequence", "without penalty",
    ],
    "summary": [
        "how many", "count", "total", "summarize", "summary", "overview",
        "statistics", "stats", "breakdown", "coverage rate", "percentage covered",
        "what is the status", "overall status", "how much is covered",
        "coverage percentage", "how covered", "give me a summary",
    ],
    "comparison": [
        "compare", "differ", "difference", "contrast", " vs ", " versus ",
        "how does", "between", "align", "consistent", "inconsistent",
        "conflict between", "contradict", "match between", "compared to",
    ],
}

# "risk" + one of these → risk_for_partial intent
_PARTIAL_RISK_QUALIFIERS = {"partial", "partially", "partially covered", "partially-covered"}

# ---------------------------------------------------------------------------
# LLM system prompts
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a procurement knowledge graph analyst. "
    "Answer based only on the provided graph evidence. "
    "Write a concise, direct answer in plain prose — 2 to 4 sentences maximum "
    "unless a list is genuinely clearer. "
    "Do NOT include element IDs, source document names, or page references in your answer text. "
    "Evidence items may include a 'connections' list showing directly linked graph nodes — "
    "use these relationships to reason about coverage chains, risk chains, and mitigation status. "
    "Items with a 'cross_doc_relationship' field show an explicit edge between two documents — "
    "use these to reason about alignment or conflicts across documents. "
    "For 'summary' evidence items, report the numbers accurately. "
    "The user sees source evidence cards separately, so focus on substance only."
)

_CLASSIFIER_SYSTEM = (
    "Classify the procurement question into exactly one of these intents: "
    "coverage_gap, risk_for_partial, no_mitigation, no_ld, summary, comparison, general. "
    "Reply with ONLY the intent name, nothing else."
)


class QAService:
    """
    Intent-aware, graph-augmented question-answering service.

    Parameters
    ----------
    store, builder, vector_store:
        Standard service dependencies.
    workspace_id:
        The workspace this service is scoped to.
    """

    _VALID_INTENTS = {
        "coverage_gap", "risk_for_partial", "no_mitigation",
        "no_ld", "summary", "comparison", "general",
    }

    def __init__(
        self,
        store: Neo4jGraphStore,
        builder: GraphBuilder,
        vector_store: QdrantVectorStore,
        workspace_id: str,
    ) -> None:
        self.store = store
        self.builder = builder
        self.vector_store = vector_store
        self._workspace_id = workspace_id
        self._client: OpenAI = OpenAI(api_key=settings.openai_api_key)

    # ------------------------------------------------------------------
    # Intent classification — two-tier
    # ------------------------------------------------------------------

    def _classify_intent(self, question: str) -> str:
        """
        Keyword scoring first; LLM fallback when no keyword matches.

        Keyword scoring counts how many phrases from each intent's keyword
        list appear in the lower-cased question.  The intent with the
        highest score wins.  Ties broken by ``general``.

        risk_for_partial requires both "risk" and a partial-qualifier word
        to win, guarding against false positives.
        """
        q = question.lower()

        scores: dict[str, int] = {intent: 0 for intent in _INTENT_KEYWORDS}
        for intent, keywords in _INTENT_KEYWORDS.items():
            for kw in keywords:
                if kw in q:
                    scores[intent] += 1

        # risk_for_partial needs "risk" + a partial qualifier
        if scores["risk_for_partial"] > 0:
            has_risk = "risk" in q
            has_partial = any(p in q for p in _PARTIAL_RISK_QUALIFIERS)
            if not (has_risk and has_partial):
                scores["risk_for_partial"] = 0

        best_intent = max(scores, key=lambda k: scores[k])
        if scores[best_intent] > 0:
            return best_intent

        # LLM fallback for phrasing that doesn't hit any keywords
        return self._classify_intent_llm(question)

    def _classify_intent_llm(self, question: str) -> str:
        """Lightweight LLM call (gpt-4o-mini, ≤10 tokens) for ambiguous questions."""
        try:
            resp = self._client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": _CLASSIFIER_SYSTEM},
                    {"role": "user", "content": question},
                ],
                max_tokens=10,
                temperature=0,
            )
            result = (resp.choices[0].message.content or "").strip().lower()
            return result if result in self._VALID_INTENTS else "general"
        except Exception as exc:
            logger.warning("LLM intent classification failed: %s", exc)
            return "general"

    # ------------------------------------------------------------------
    # Shared graph expansion helpers
    # ------------------------------------------------------------------

    def _expand_neighbors(self, element_id: str, max_neighbors: int = 3) -> list[dict[str, Any]]:
        """1-hop neighbors formatted as connection dicts (no sub-connections)."""
        raw = self.store.get_neighborhood(element_id, self._workspace_id, max_neighbors=max_neighbors)
        result: list[dict[str, Any]] = []
        for nb in raw:
            conn: dict[str, Any] = {
                "id": nb["id"],
                "type": nb["type"],
                "text": nb["text"],
                "source": nb["source"],
                "rel": nb["rel_type"],
                "direction": nb["direction"],
            }
            if nb.get("page_number") is not None:
                conn["page_number"] = nb["page_number"]
            result.append(conn)
        return result

    def _expand_two_hops(
        self,
        connections: list[dict[str, Any]],
        seen_ids: set[str],
    ) -> None:
        """
        Mutates *connections* in place: for each connection whose type is
        Risk or Requirement, attach its own 1-hop neighbors as a nested
        ``connections`` list (capped at 2 per bridge node, 8 total).

        Bridge nodes: Risk (→ mitigation, LD) and Requirement (← covering clauses).
        """
        BRIDGE_TYPES = {"Risk", "Requirement"}
        second_hop_budget = 8

        for conn in connections:
            if second_hop_budget <= 0:
                break
            if conn.get("type") not in BRIDGE_TYPES:
                continue
            raw = self.store.get_neighborhood(
                conn["id"], self._workspace_id, max_neighbors=2
            )
            sub: list[dict[str, Any]] = []
            for nb in raw:
                if second_hop_budget <= 0:
                    break
                if nb["id"] in seen_ids:
                    continue
                seen_ids.add(nb["id"])
                second_hop_budget -= 1
                sc: dict[str, Any] = {
                    "id": nb["id"],
                    "type": nb["type"],
                    "text": nb["text"],
                    "source": nb["source"],
                    "rel": nb["rel_type"],
                    "direction": nb["direction"],
                }
                if nb.get("page_number") is not None:
                    sc["page_number"] = nb["page_number"]
                sub.append(sc)
            if sub:
                conn["connections"] = sub

    # ------------------------------------------------------------------
    # Evidence gatherers — structured intents
    # ------------------------------------------------------------------

    def _gather_coverage_gap_evidence(self) -> list[dict[str, Any]]:
        """Requirements with no clause coverage + their linked risks."""
        coverage = self.builder.assess_coverage(self._workspace_id)
        uncovered = [c for c in coverage if c.status == CoverageStatus.NOT_COVERED]
        evidence: list[dict[str, Any]] = []
        for c in uncovered:
            req = self.store.get_element(c.requirement_id, self._workspace_id)
            item: dict[str, Any] = {
                "id": c.requirement_id,
                "text": c.requirement_text,
                "status": c.status.value,
                "source": c.source,
            }
            if req and req.metadata.get("page_number") is not None:
                item["page_number"] = req.metadata["page_number"]
            connections = self._expand_neighbors(c.requirement_id, max_neighbors=3)
            if connections:
                item["connections"] = connections
            evidence.append(item)
        return evidence

    def _gather_risk_for_partial_evidence(self) -> list[dict[str, Any]]:
        """Risks linked to partially-covered requirements."""
        coverage = self.builder.assess_coverage(self._workspace_id)
        partial = [c for c in coverage if c.status == CoverageStatus.PARTIAL]
        evidence: list[dict[str, Any]] = []
        for c in partial:
            for risk_id in c.risks:
                risk = self.store.get_element(risk_id, self._workspace_id)
                if risk is not None:
                    item: dict[str, Any] = {
                        "requirement": c.requirement_id,
                        "risk_id": risk_id,
                        "risk_text": risk.text,
                        "source": risk.source,
                    }
                    if risk.metadata.get("page_number") is not None:
                        item["page_number"] = risk.metadata["page_number"]
                    connections = self._expand_neighbors(risk_id, max_neighbors=3)
                    if connections:
                        item["connections"] = connections
                    evidence.append(item)
        return evidence

    def _gather_no_mitigation_evidence(self) -> list[dict[str, Any]]:
        """Risks with no MITIGATED_BY edge + their parent requirements."""
        risks = self.store.get_elements_by_type(ElementType.RISK, self._workspace_id)
        evidence: list[dict[str, Any]] = []
        for risk in risks:
            outgoing = self.store.get_outgoing_relationships(risk.id, self._workspace_id)
            if any(r.type == RelationshipType.MITIGATED_BY for r in outgoing):
                continue
            item: dict[str, Any] = {"id": risk.id, "text": risk.text, "source": risk.source}
            if risk.metadata.get("page_number") is not None:
                item["page_number"] = risk.metadata["page_number"]
            connections = self._expand_neighbors(risk.id, max_neighbors=3)
            if connections:
                item["connections"] = connections
            evidence.append(item)
        return evidence

    def _gather_no_ld_evidence(self) -> list[dict[str, Any]]:
        """Risks with no LINKED_TO_LD edge."""
        risks = self.store.get_elements_by_type(ElementType.RISK, self._workspace_id)
        evidence: list[dict[str, Any]] = []
        for risk in risks:
            outgoing = self.store.get_outgoing_relationships(risk.id, self._workspace_id)
            if any(r.type == RelationshipType.LINKED_TO_LD for r in outgoing):
                continue
            item: dict[str, Any] = {"id": risk.id, "text": risk.text, "source": risk.source}
            if risk.metadata.get("page_number") is not None:
                item["page_number"] = risk.metadata["page_number"]
            connections = self._expand_neighbors(risk.id, max_neighbors=3)
            if connections:
                item["connections"] = connections
            evidence.append(item)
        return evidence

    # ------------------------------------------------------------------
    # Evidence gatherers — summary
    # ------------------------------------------------------------------

    def _gather_summary_evidence(self) -> list[dict[str, Any]]:
        """
        Aggregate coverage and risk statistics across the workspace.

        Returns a single evidence item with a ``summary`` dict so the LLM
        can report exact numbers.
        """
        coverage = self.builder.assess_coverage(self._workspace_id)
        covered = sum(1 for c in coverage if c.status == CoverageStatus.COVERED)
        partial = sum(1 for c in coverage if c.status == CoverageStatus.PARTIAL)
        not_covered = sum(1 for c in coverage if c.status == CoverageStatus.NOT_COVERED)

        risks = self.store.get_elements_by_type(ElementType.RISK, self._workspace_id)
        mitigated = 0
        with_ld = 0
        for risk in risks:
            outgoing = self.store.get_outgoing_relationships(risk.id, self._workspace_id)
            if any(r.type == RelationshipType.MITIGATED_BY for r in outgoing):
                mitigated += 1
            if any(r.type == RelationshipType.LINKED_TO_LD for r in outgoing):
                with_ld += 1

        return [
            {
                "summary": {
                    "requirements": {
                        "total": len(coverage),
                        "covered": covered,
                        "partially_covered": partial,
                        "not_covered": not_covered,
                    },
                    "risks": {
                        "total": len(risks),
                        "mitigated": mitigated,
                        "unmitigated": len(risks) - mitigated,
                        "with_ld": with_ld,
                        "without_ld": len(risks) - with_ld,
                    },
                }
            }
        ]

    # ------------------------------------------------------------------
    # Evidence gatherers — comparison
    # ------------------------------------------------------------------

    def _gather_comparison_evidence(self, question: str) -> list[dict[str, Any]]:
        """
        Cross-document comparison evidence.

        1. Wide Qdrant search (n=10), grouped by document — ensures at least
           2-3 items per document are visible to the LLM.
        2. 1-hop graph expansion on each seed for relationship context.
        3. Explicit cross-document Neo4j edges that involve the seed nodes
           are appended so the LLM can reason about direct graph alignment.
        """
        evidence: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        try:
            seeds: list[AtomicElement] = self.vector_store.search(question, n_results=10)
            seed_ids = {s.id for s in seeds}

            # Group by document, stable order
            by_doc: dict[str, list[AtomicElement]] = {}
            for elem in seeds:
                by_doc.setdefault(elem.document_id or "_unknown", []).append(elem)

            for _doc_id, elems in sorted(by_doc.items()):
                for elem in elems[:3]:   # max 3 per document
                    if elem.id in seen_ids:
                        continue
                    seen_ids.add(elem.id)
                    item: dict[str, Any] = {
                        "id": elem.id,
                        "type": elem.type.value,
                        "text": elem.text,
                        "source": elem.source,
                        "document_id": elem.document_id,
                    }
                    if elem.metadata.get("page_number") is not None:
                        item["page_number"] = elem.metadata["page_number"]
                    connections = self._expand_neighbors(elem.id, max_neighbors=4)
                    if connections:
                        item["connections"] = connections
                    evidence.append(item)

            # Append explicit cross-document edges involving these seeds
            cross_rels = self.store.get_cross_document_relationships(self._workspace_id)
            for rel in cross_rels:
                if rel["src_id"] in seed_ids or rel["tgt_id"] in seed_ids:
                    evidence.append({
                        "cross_doc_relationship": rel["rtype"],
                        "from": {
                            "id": rel["src_id"],
                            "text": rel["src_text"],
                            "source": rel["src_source"],
                            "doc": rel["src_doc"],
                        },
                        "to": {
                            "id": rel["tgt_id"],
                            "text": rel["tgt_text"],
                            "source": rel["tgt_source"],
                            "doc": rel["tgt_doc"],
                        },
                        "evidence": rel.get("ev", ""),
                    })
        except Exception as exc:
            logger.warning("Comparison evidence failed: %s", exc)

        return evidence

    # ------------------------------------------------------------------
    # Evidence gatherers — general (vector + 2-hop graph + Graphiti)
    # ------------------------------------------------------------------

    def _gather_general_evidence(self, question: str) -> list[dict[str, Any]]:
        """
        Graph-augmented general retrieval.

        Step 1  Qdrant vector search → 5 seed nodes
        Step 2  1-hop Neo4j expansion on each seed (max 4 neighbors, priority-sorted)
        Step 3  2-hop expansion on Risk/Requirement bridge nodes (max 2 each, 8 total)
        Step 4  Graphiti entity search → memory-layer facts appended
        """
        evidence: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        try:
            seeds: list[AtomicElement] = self.vector_store.search(question, n_results=5)
            for elem in seeds:
                if elem.id in seen_ids:
                    continue
                seen_ids.add(elem.id)

                item: dict[str, Any] = {
                    "id": elem.id,
                    "type": elem.type.value,
                    "text": elem.text,
                    "source": elem.source,
                }
                if elem.metadata.get("page_number") is not None:
                    item["page_number"] = elem.metadata["page_number"]

                # 1-hop
                raw_neighbors = self.store.get_neighborhood(
                    elem.id, self._workspace_id, max_neighbors=4
                )
                connections: list[dict[str, Any]] = []
                for nb in raw_neighbors:
                    conn: dict[str, Any] = {
                        "id": nb["id"],
                        "type": nb["type"],
                        "text": nb["text"],
                        "source": nb["source"],
                        "rel": nb["rel_type"],
                        "direction": nb["direction"],
                    }
                    if nb.get("page_number") is not None:
                        conn["page_number"] = nb["page_number"]
                    if nb["id"] not in seen_ids:
                        seen_ids.add(nb["id"])
                    connections.append(conn)

                # 2-hop: expand Risk / Requirement bridges
                self._expand_two_hops(connections, seen_ids)

                if connections:
                    item["connections"] = connections
                evidence.append(item)
        except Exception as exc:
            logger.warning("Vector search / graph expansion failed: %s", exc)

        return evidence

    # ------------------------------------------------------------------
    # LLM synthesis
    # ------------------------------------------------------------------

    def _synthesize(self, question: str, evidence: list[dict[str, Any]]) -> str:
        evidence_str = json.dumps(evidence, indent=2, ensure_ascii=False)
        try:
            response = self._client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": f"Question: {question}\n\nGraph evidence:\n{evidence_str}",
                    },
                ],
                max_tokens=400,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.error("LLM synthesis failed: %s", exc)
            return f"Could not generate answer: {exc}"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def answer(self, question: str) -> dict[str, Any]:
        """
        Answer a natural-language question about the knowledge graph.

        Returns
        -------
        dict with keys:
            ``answer``     — LLM-generated prose
            ``evidence``   — list of evidence dicts (shown as cards in the UI)
            ``query_type`` — classified intent string
        """
        logger.info("QAService.answer | question=%r", question[:120])

        intent = self._classify_intent(question)
        logger.debug("Classified intent: %s", intent)

        if intent == "coverage_gap":
            evidence = self._gather_coverage_gap_evidence()
        elif intent == "risk_for_partial":
            evidence = self._gather_risk_for_partial_evidence()
        elif intent == "no_mitigation":
            evidence = self._gather_no_mitigation_evidence()
        elif intent == "no_ld":
            evidence = self._gather_no_ld_evidence()
        elif intent == "summary":
            evidence = self._gather_summary_evidence()
        elif intent == "comparison":
            evidence = self._gather_comparison_evidence(question)
        else:
            evidence = self._gather_general_evidence(question)

        logger.info("Evidence gathered: %d items (intent=%s)", len(evidence), intent)

        answer_text = self._synthesize(question, evidence)
        return {"answer": answer_text, "evidence": evidence, "query_type": intent}
