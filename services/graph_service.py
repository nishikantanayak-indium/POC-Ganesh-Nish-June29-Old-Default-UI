"""
Graph service: knowledge-graph construction, querying, and visualisation.

This service owns the long-lived infrastructure objects (Neo4j store, Qdrant
vector store, Graphiti memory) and exposes a clean, Streamlit-friendly API
that hides the multi-layer persistence details.

Lifecycle
---------
Create one :class:`GraphService` instance at app start-up (e.g. inside
``st.session_state``).  Call :meth:`close` when the session ends to release
the Neo4j driver connection pool.  The object is also usable as a context
manager::

    with GraphService() as gs:
        gs.build_knowledge_graph(docs, elements, rels)
        html = gs.get_visualization_html()
"""

from __future__ import annotations

import logging
from typing import Any

from core.models import (
    AtomicElement,
    CoverageResult,
    ParsedDocument,
    Relationship,
)
from graph import GraphBuilder, GraphitiMemory, GraphVisualizer, Neo4jGraphStore
from vector import QdrantVectorStore

logger = logging.getLogger(__name__)


class GraphService:
    """
    Facade over the graph and vector storage layers.

    All public methods are **synchronous** — Graphiti async calls are
    transparently handled by :meth:`~graph.graphiti_memory.GraphitiMemory.ingest_document_sync`
    and :meth:`~graph.graphiti_memory.GraphitiMemory.search_graph_sync`.

    Attributes
    ----------
    store:
        The open :class:`~graph.neo4j_store.Neo4jGraphStore` instance.
    graphiti:
        The :class:`~graph.graphiti_memory.GraphitiMemory` client.
    builder:
        The :class:`~graph.builder.GraphBuilder` that writes to *store*.
    visualizer:
        The :class:`~graph.visualizer.GraphVisualizer` that reads from *store*.
    vector_store:
        The :class:`~vector.qdrant_store.QdrantVectorStore` for semantic search.
    """

    def __init__(self) -> None:
        self.store: Neo4jGraphStore = Neo4jGraphStore()
        self.graphiti: GraphitiMemory = GraphitiMemory()
        self.builder: GraphBuilder = GraphBuilder(self.store)
        self.visualizer: GraphVisualizer = GraphVisualizer(self.store)
        self.vector_store: QdrantVectorStore = QdrantVectorStore()

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "GraphService":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def build_knowledge_graph(
        self,
        documents: list[ParsedDocument],
        elements: list[AtomicElement],
        relationships: list[Relationship],
        doc_hashes: dict[str, str] | None = None,
    ) -> None:
        """
        Populate all three storage layers from extraction pipeline outputs.

        Steps performed (in order):

        1. Write a typed schema graph (Document nodes, Element nodes, typed
           edges) into Neo4j via :class:`~graph.builder.GraphBuilder`.
        2. Encode and upsert all elements into Qdrant for semantic search.
        3. Ingest each document's pages as Graphiti episodes (non-blocking;
           failures are logged as warnings, not raised).

        Parameters
        ----------
        documents:
            Source documents returned by :class:`~services.document_service.DocumentService`.
        elements:
            All atomic elements extracted across all documents.
        relationships:
            Inferred typed directed relationships (cross-document included).
        doc_hashes:
            Optional ``{doc_id: sha256_hex}`` map; stored on Document nodes so
            that re-uploads of the same file are detected and skipped.
        """
        logger.info(
            "Building knowledge graph: %d docs, %d elements, %d relationships",
            len(documents),
            len(elements),
            len(relationships),
        )

        # --- 1. Typed schema graph in Neo4j ----------------------------
        self.builder.build_from_elements(elements, relationships, documents, doc_hashes)
        logger.info(
            "Neo4j build complete — nodes: %d, edges: %d",
            self.store.node_count,
            self.store.edge_count,
        )

        # --- 2. Semantic index in Qdrant --------------------------------
        self.vector_store.upsert(elements)
        logger.info("Qdrant upsert complete — %d elements indexed", len(elements))

        # --- 3. Graphiti episode ingestion (non-blocking) ---------------
        for doc in documents:
            doc_elements = [e for e in elements if e.document_id == doc.id]
            self.graphiti.ingest_document_sync(doc, doc_elements)
        logger.info("Graphiti ingestion complete")

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def load_existing_data(self) -> tuple[list[AtomicElement], list[CoverageResult]]:
        """
        Restore session state from an already-populated Neo4j graph.

        Call on app startup when Neo4j has nodes but session_state is empty
        (e.g. after a page refresh or server restart).  No file re-upload or
        LLM extraction is needed.

        Returns
        -------
        tuple[list[AtomicElement], list[CoverageResult]]
            Empty lists if the graph has no data.
        """
        elements = self.store.get_all_elements()
        if not elements:
            return [], []
        coverage = self.builder.assess_coverage()
        logger.info(
            "Restored %d elements and %d coverage results from Neo4j",
            len(elements),
            len(coverage),
        )
        return elements, coverage

    def get_ingested_doc_hashes(self) -> dict[str, str]:
        """Return ``{doc_id: sha256_hex}`` for documents already in Neo4j."""
        try:
            return self.store.get_document_hashes()
        except Exception:
            return {}

    def reset_graph(self) -> None:
        """
        Permanently delete all data from Neo4j and Qdrant.

        This is the **only** place that calls ``store.clear()`` and
        ``vector_store.clear()``.  UI code should call this method rather
        than reaching into the stores directly, so the operation stays
        intentional and auditable.
        """
        self.store.clear()
        self.vector_store.clear()
        logger.warning("Graph reset: all Neo4j nodes and Qdrant vectors deleted")

    # ------------------------------------------------------------------
    # Coverage & traceability
    # ------------------------------------------------------------------

    def get_coverage_results(self) -> list[CoverageResult]:
        """
        Compute a coverage verdict for every Requirement in the graph.

        Returns
        -------
        list[CoverageResult]
            One entry per Requirement node; see
            :meth:`~graph.builder.GraphBuilder.assess_coverage` for the
            coverage-rule details.
        """
        return self.builder.assess_coverage()

    def get_traceability(self, req_id: str) -> dict[str, Any]:
        """
        Return the full traceability chain for requirement *req_id*.

        Parameters
        ----------
        req_id:
            The ``id`` of the Requirement element (e.g. ``"REQ_001"``).

        Returns
        -------
        dict
            Keys: ``requirement``, ``full_coverage``, ``partial_coverage``,
            ``risks``, ``mitigations``, ``lds``, ``gaps``.
            Empty dict if *req_id* is not found.
        """
        return self.builder.get_traceability_chain(req_id)

    # ------------------------------------------------------------------
    # Visualisation
    # ------------------------------------------------------------------

    def get_visualization_html(self, show_contains: bool = False) -> str:
        """
        Generate a self-contained pyvis HTML string for the full graph.

        Parameters
        ----------
        show_contains:
            When ``False`` (default), ``CONTAINS`` edges are hidden to
            reduce clutter.

        Returns
        -------
        str
            HTML string suitable for ``st.components.v1.html``.
        """
        return self.visualizer.generate_html(show_contains=show_contains)

    def get_subgraph_html(self, node_id: str) -> str:
        """
        Generate a pyvis HTML string for the ego-network around *node_id*.

        Parameters
        ----------
        node_id:
            Centre-node element ID.  If not found, returns a minimal error
            HTML paragraph.

        Returns
        -------
        str
            Self-contained HTML string.
        """
        return self.visualizer.generate_subgraph_html(node_id)

    # ------------------------------------------------------------------
    # Element access
    # ------------------------------------------------------------------

    def get_all_elements(self) -> list[AtomicElement]:
        """Return every non-Document element currently in the Neo4j store."""
        return self.store.get_all_elements()

    # ------------------------------------------------------------------
    # Graph statistics
    # ------------------------------------------------------------------

    def get_node_count(self) -> int:
        """Total number of Element nodes in Neo4j."""
        return self.store.node_count

    def get_edge_count(self) -> int:
        """Total number of directed relationships in Neo4j."""
        return self.store.edge_count

    # ------------------------------------------------------------------
    # Teardown
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Release the Neo4j driver and all associated resources."""
        self.store.close()
        logger.info("GraphService closed")
