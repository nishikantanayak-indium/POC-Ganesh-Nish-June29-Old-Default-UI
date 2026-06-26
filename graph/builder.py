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
        for doc in documents:
            with self.store._driver.session(database=self.store._db) as s:
                s.run(
                    "MERGE (e:Element {id: $id}) "
                    "SET e.type = 'Document', "
                    "    e.text = $text, "
                    "    e.source = $src, "
                    "    e.document_id = $did, "
                    "    e.confidence = 1.0",
                    id=doc.id,
                    text=doc.name,
                    src=doc.type.value,
                    did=doc.id,
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

    def get_traceability_chain(self, req_id: str) -> dict[str, Any]:
        """
        Return the full traceability chain for a single requirement.

        The returned dict contains:

        * ``requirement``    — :func:`dataclasses.asdict` of the element
        * ``full_coverage``  — Clause IDs with a ``COVERS`` edge
        * ``partial_coverage`` — Clause IDs with a ``PARTIALLY_COVERS`` edge
        * ``risks``          — Risk IDs introduced by this requirement
        * ``mitigations``    — Mitigation IDs for those risks
        * ``lds``            — Liquidated Damages IDs linked to this req or its risks
        * ``gaps``           — Human-readable gap descriptions

        Returns an empty dict if *req_id* does not exist in the store.
        """
        req = self.store.get_element(req_id)
        if req is None:
            return {}

        full_coverage = [
            r.source_id
            for r in self.store.get_incoming_relationships(
                req_id, RelationshipType.COVERS
            )
        ]
        partial_coverage = [
            r.source_id
            for r in self.store.get_incoming_relationships(
                req_id, RelationshipType.PARTIALLY_COVERS
            )
        ]
        risks = [
            r.target_id
            for r in self.store.get_outgoing_relationships(
                req_id, RelationshipType.INTRODUCES_RISK
            )
        ]

        mitigations: list[str] = []
        lds: list[str] = [
            r.target_id
            for r in self.store.get_outgoing_relationships(
                req_id, RelationshipType.LINKED_TO_LD
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

        # --- Gap analysis -----------------------------------------------
        gaps: list[str] = []
        if not full_coverage and not partial_coverage:
            gaps.append("No contract clause covers this requirement")
        if risks and not mitigations:
            gaps.append(f"Risks {risks} have no mitigation")
        if risks and not lds:
            gaps.append(f"Risks {risks} have no Liquidated Damages")

        return {
            "requirement": dataclasses.asdict(req),
            "full_coverage": full_coverage,
            "partial_coverage": partial_coverage,
            "risks": risks,
            "mitigations": mitigations,
            "lds": list(set(lds)),
            "gaps": gaps,
        }
