"""
High-level graph construction and analysis utilities.

:class:`GraphBuilder` accepts the raw outputs of the extraction pipeline
(elements + relationships + documents) and orchestrates writing them into
a :class:`~graph.neo4j_store.Neo4jGraphStore`.  It also provides coverage
assessment and traceability chain queries that operate over the persisted
graph.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any

from core.models import (
    AtomicElement,
    CoverageResult,
    CoverageStatus,
    ElementType,
    ParsedDocument,
    Relationship,
    RelationshipType,
)
from .neo4j_store import Neo4jGraphStore

logger = logging.getLogger(__name__)


class GraphBuilder:
    """
    Orchestrates the full ingestion pipeline and graph-level analytics.

    Parameters
    ----------
    store:
        An open :class:`~graph.neo4j_store.Neo4jGraphStore` instance.
        The builder does **not** own the store's lifetime; callers are
        responsible for closing it.
    """

    def __init__(self, store: Neo4jGraphStore) -> None:
        self.store = store

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def build_from_elements(
        self,
        elements: list[AtomicElement],
        relationships: list[Relationship],
        documents: list[ParsedDocument],
        doc_hashes: dict[str, str] | None = None,
    ) -> None:
        """
        Populate the graph store from extraction pipeline outputs.

        Steps
        -----
        1. Clear the existing graph (full re-ingestion semantics).
        2. Write a ``Document`` pseudo-node for each source document.
        3. Write all typed :class:`~core.models.AtomicElement` nodes.
        4. Create ``CONTAINS`` edges from each Document to its elements.
        5. Write all inferred typed relationships.

        Parameters
        ----------
        elements:
            All atomic elements extracted across all documents.
        relationships:
            Inferred typed edges between elements (cross-document included).
        documents:
            The source documents; used to create Document pseudo-nodes.
        """
        logger.info(
            "Building graph: %d documents, %d elements, %d relationships",
            len(documents),
            len(elements),
            len(relationships),
        )

        self.store.clear()

        # --- 1. Document pseudo-nodes -----------------------------------
        _hashes = doc_hashes or {}
        for doc in documents:
            with self.store._driver.session(database=self.store._db) as s:
                s.run(
                    "MERGE (e:Element {id: $id}) "
                    "SET e.type = 'Document', "
                    "    e.text = $text, "
                    "    e.source = $src, "
                    "    e.document_id = $did, "
                    "    e.confidence = 1.0, "
                    "    e.doc_hash = $hash",
                    id=doc.id,
                    text=doc.name,
                    src=doc.type.value,
                    did=doc.id,
                    hash=_hashes.get(doc.id, ""),
                )

        # --- 2. Typed element nodes -------------------------------------
        for elem in elements:
            self.store.add_element(elem)

        # --- 3. CONTAINS relationships (Document → Element) ------------
        for elem in elements:
            self.store.add_relationship(
                Relationship(
                    source_id=elem.document_id,
                    target_id=elem.id,
                    type=RelationshipType.CONTAINS,
                    confidence=1.0,
                    evidence="Document contains this element",
                )
            )

        # --- 4. Inferred semantic relationships -------------------------
        for rel in relationships:
            self.store.add_relationship(rel)

        logger.info(
            "Graph build complete. Nodes: %d, Edges: %d",
            self.store.node_count,
            self.store.edge_count,
        )

    # ------------------------------------------------------------------
    # Coverage analysis
    # ------------------------------------------------------------------

    def assess_coverage(self) -> list[CoverageResult]:
        """
        Compute a :class:`~core.models.CoverageResult` for every Requirement.

        Coverage rules
        ~~~~~~~~~~~~~~
        * **Covered**          — at least one incoming ``COVERS`` edge.
        * **Partially Covered** — no ``COVERS`` but at least one ``PARTIALLY_COVERS``.
        * **Not Covered**      — neither.

        Returns
        -------
        list of CoverageResult
            One entry per Requirement node, ordered by store insertion order.
        """
        requirements = self.store.get_elements_by_type(ElementType.REQUIREMENT)
        results: list[CoverageResult] = []

        for req in requirements:
            full_coverage = [
                r.source_id
                for r in self.store.get_incoming_relationships(
                    req.id, RelationshipType.COVERS
                )
            ]
            partial_coverage = [
                r.source_id
                for r in self.store.get_incoming_relationships(
                    req.id, RelationshipType.PARTIALLY_COVERS
                )
            ]
            risks = [
                r.target_id
                for r in self.store.get_outgoing_relationships(
                    req.id, RelationshipType.INTRODUCES_RISK
                )
            ]

            mitigations: list[str] = []
            lds: list[str] = [
                r.target_id
                for r in self.store.get_outgoing_relationships(
                    req.id, RelationshipType.LINKED_TO_LD
                )
            ]

            for risk_id in risks:
                mitigations.extend(
                    r.target_id
                    for r in self.store.get_outgoing_relationships(
                        risk_id, RelationshipType.MITIGATED_BY
                    )
                )
                lds.extend(
                    r.target_id
                    for r in self.store.get_outgoing_relationships(
                        risk_id, RelationshipType.LINKED_TO_LD
                    )
                )

            if full_coverage:
                status = CoverageStatus.COVERED
            elif partial_coverage:
                status = CoverageStatus.PARTIAL
            else:
                status = CoverageStatus.NOT_COVERED

            results.append(
                CoverageResult(
                    requirement_id=req.id,
                    requirement_text=req.text,
                    status=status,
                    covering_clauses=full_coverage + partial_coverage,
                    risks=risks,
                    mitigations=list(set(mitigations)),
                    lds=list(set(lds)),
                    source=req.source,
                )
            )

        return results

    # ------------------------------------------------------------------
    # Traceability
    # ------------------------------------------------------------------

    def _enrich(
        self,
        element_id: str,
        relationship: str,
        req_document_id: str,
    ) -> dict[str, Any] | None:
        """
        Fetch an element by *element_id* and return an enriched dict.

        Returns ``None`` if the element cannot be found in the store.

        The returned shape is::

            {
                "id": "CLS_001",
                "type": "Clause",
                "text": "...",
                "source": "Contract Page 3",
                "document_id": "doc_contract",
                "relationship": "COVERS",
                "is_inter_document": True,
            }

        ``is_inter_document`` is ``True`` when the element's ``document_id``
        differs from *req_document_id*.
        """
        elem = self.store.get_element(element_id)
        if elem is None:
            logger.warning("_enrich: element %r not found", element_id)
            return None
        return {
            "id": elem.id,
            "type": elem.type.value if hasattr(elem.type, "value") else str(elem.type),
            "text": elem.text,
            "source": elem.source,
            "document_id": elem.document_id,
            "relationship": relationship,
            "is_inter_document": elem.document_id != req_document_id,
        }

    def get_traceability_chain(self, req_id: str) -> dict[str, Any]:
        """
        Return the full traceability chain for a single requirement.

        The returned dict contains:

        * ``requirement``      — enriched ChainElement dict for the requirement
        * ``full_coverage``    — list of enriched ChainElements (``COVERS``)
        * ``partial_coverage`` — list of enriched ChainElements (``PARTIALLY_COVERS``)
        * ``risks``            — list of enriched ChainElements (``INTRODUCES_RISK``)
        * ``mitigations``      — deduplicated list of enriched ChainElements (``MITIGATED_BY``)
        * ``lds``              — deduplicated list of enriched ChainElements (``LINKED_TO_LD``)
        * ``gaps``             — Human-readable gap descriptions

        Returns an empty dict if *req_id* does not exist in the store.
        """
        req = self.store.get_element(req_id)
        if req is None:
            return {}

        req_doc_id = req.document_id

        full_coverage_ids = [
            r.source_id
            for r in self.store.get_incoming_relationships(
                req_id, RelationshipType.COVERS
            )
        ]
        partial_coverage_ids = [
            r.source_id
            for r in self.store.get_incoming_relationships(
                req_id, RelationshipType.PARTIALLY_COVERS
            )
        ]
        risk_ids = [
            r.target_id
            for r in self.store.get_outgoing_relationships(
                req_id, RelationshipType.INTRODUCES_RISK
            )
        ]

        mitigation_ids: list[str] = []
        ld_ids: list[str] = [
            r.target_id
            for r in self.store.get_outgoing_relationships(
                req_id, RelationshipType.LINKED_TO_LD
            )
        ]

        for risk_id in risk_ids:
            mitigation_ids.extend(
                r.target_id
                for r in self.store.get_outgoing_relationships(
                    risk_id, RelationshipType.MITIGATED_BY
                )
            )
            ld_ids.extend(
                r.target_id
                for r in self.store.get_outgoing_relationships(
                    risk_id, RelationshipType.LINKED_TO_LD
                )
            )

        # --- Gap analysis -----------------------------------------------
        gaps: list[str] = []
        if not full_coverage_ids and not partial_coverage_ids:
            gaps.append("No contract clause covers this requirement")
        if risk_ids and not mitigation_ids:
            gaps.append(f"Risks {risk_ids} have no mitigation")
        if risk_ids and not ld_ids:
            gaps.append(f"Risks {risk_ids} have no Liquidated Damages")

        # --- Enrich all IDs into ChainElement dicts ---------------------
        def enrich_list(ids: list[str], rel: str) -> list[dict[str, Any]]:
            result = []
            for eid in ids:
                enriched = self._enrich(eid, rel, req_doc_id)
                if enriched is not None:
                    result.append(enriched)
            return result

        def enrich_dedup(ids: list[str], rel: str) -> list[dict[str, Any]]:
            seen: set[str] = set()
            result = []
            for eid in ids:
                if eid in seen:
                    continue
                seen.add(eid)
                enriched = self._enrich(eid, rel, req_doc_id)
                if enriched is not None:
                    result.append(enriched)
            return result

        req_enriched = {
            "id": req.id,
            "type": req.type.value if hasattr(req.type, "value") else str(req.type),
            "text": req.text,
            "source": req.source,
            "document_id": req.document_id,
            "relationship": "",
            "is_inter_document": False,
        }

        return {
            "requirement": req_enriched,
            "full_coverage": enrich_list(full_coverage_ids, "COVERS"),
            "partial_coverage": enrich_list(partial_coverage_ids, "PARTIALLY_COVERS"),
            "risks": enrich_list(risk_ids, "INTRODUCES_RISK"),
            "mitigations": enrich_dedup(mitigation_ids, "MITIGATED_BY"),
            "lds": enrich_dedup(ld_ids, "LINKED_TO_LD"),
            "gaps": gaps,
        }
