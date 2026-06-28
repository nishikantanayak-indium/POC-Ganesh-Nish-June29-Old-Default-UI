"""
Neo4j-backed graph store for the GraphRAG POC.

Implements :class:`core.interfaces.IGraphStore` using the official
neo4j Python driver v5+.  All Cypher is written against Neo4j 5.x syntax.
"""

from __future__ import annotations

import logging
from typing import Optional

from neo4j import GraphDatabase, Driver

from core.models import AtomicElement, Relationship, ElementType, RelationshipType
from core.interfaces import IGraphStore
from core.exceptions import GraphStoreError
from config.settings import settings

logger = logging.getLogger(__name__)


class Neo4jGraphStore(IGraphStore):
    """
    Persistent graph store backed by a Neo4j instance.

    A single :class:`~neo4j.Driver` is held for the lifetime of this object;
    call :meth:`close` (or use as a context manager) when finished.
    """

    # ------------------------------------------------------------------
    # Construction / teardown
    # ------------------------------------------------------------------

    def __init__(self) -> None:
        self._driver: Driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        self._db: str = settings.neo4j_database
        self._setup_constraints()

    def _setup_constraints(self) -> None:
        """Create uniqueness constraint and indexes on first run (idempotent)."""
        with self._driver.session(database=self._db) as s:
            s.run(
                "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Element) REQUIRE e.id IS UNIQUE"
            )
            s.run(
                "CREATE INDEX IF NOT EXISTS FOR (e:Element) ON (e.type)"
            )
            s.run(
                "CREATE INDEX IF NOT EXISTS FOR (e:Element) ON (e.document_id)"
            )
            s.run("CREATE INDEX IF NOT EXISTS FOR (e:Element) ON (e.section)")

    def close(self) -> None:
        """Close the underlying driver and free connection-pool resources."""
        self._driver.close()

    def __enter__(self) -> "Neo4jGraphStore":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # IGraphStore — write operations
    # ------------------------------------------------------------------

    def add_element(self, element: AtomicElement) -> None:
        """Upsert *element* into the graph (MERGE on ``id``)."""
        query = (
            "MERGE (e:Element {id: $id}) "
            "SET e.type = $type, "
            "    e.text = $text, "
            "    e.source = $source, "
            "    e.document_id = $document_id, "
            "    e.confidence = $confidence, "
            "    e.metadata = $metadata, "
            "    e.section = $section"
        )
        params = {
            "id": element.id,
            "type": element.type.value,
            "text": element.text,
            "source": element.source,
            "document_id": element.document_id,
            "confidence": element.confidence,
            "metadata": str(element.metadata),
            "section": element.metadata.get("section", ""),
        }
        try:
            with self._driver.session(database=self._db) as s:
                s.run(query, **params)
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to add element '{element.id}': {exc}"
            ) from exc

    def add_relationship(self, rel: Relationship) -> None:
        """
        Upsert a typed directed relationship between two existing elements.

        Uses OPTIONAL MATCH so that if either node is missing the query is
        silently skipped (no error).  Dynamic relationship types require
        string interpolation — the value is always an enum member so it is
        safe from injection.
        """
        rel_type_str = rel.type.value  # e.g. "COVERS"
        query = (
            f"MATCH (a:Element {{id: $src}}), (b:Element {{id: $tgt}}) "
            f"MERGE (a)-[r:{rel_type_str}]->(b) "
            f"SET r.confidence = $conf, r.evidence = $ev"
        )
        params = {
            "src": rel.source_id,
            "tgt": rel.target_id,
            "conf": rel.confidence,
            "ev": rel.evidence,
        }
        try:
            with self._driver.session(database=self._db) as s:
                s.run(query, **params)
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to add relationship {rel.source_id!r} -[{rel_type_str}]-> "
                f"{rel.target_id!r}: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # IGraphStore — read operations
    # ------------------------------------------------------------------

    def get_element(self, element_id: str) -> Optional[AtomicElement]:
        """Return the element with *element_id*, or ``None`` if not found."""
        try:
            with self._driver.session(database=self._db) as s:
                result = s.run(
                    "MATCH (e:Element {id: $id}) RETURN e", id=element_id
                )
                record = result.single()
                if record is None:
                    return None
                return self._node_to_element(record["e"])
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch element '{element_id}': {exc}"
            ) from exc

    def get_all_elements(self) -> list[AtomicElement]:
        """Return every non-Document element currently in the store."""
        try:
            with self._driver.session(database=self._db) as s:
                result = s.run(
                    "MATCH (e:Element) WHERE e.type <> 'Document' RETURN e"
                )
                return [self._node_to_element(r["e"]) for r in result]
        except Exception as exc:
            raise GraphStoreError(f"Failed to fetch all elements: {exc}") from exc

    def get_elements_by_type(self, element_type: ElementType) -> list[AtomicElement]:
        """Return all elements whose ``type`` matches *element_type*."""
        try:
            with self._driver.session(database=self._db) as s:
                result = s.run(
                    "MATCH (e:Element {type: $type}) RETURN e",
                    type=element_type.value,
                )
                return [self._node_to_element(r["e"]) for r in result]
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch elements of type '{element_type.value}': {exc}"
            ) from exc

    def get_relationships(self, element_id: str) -> list[Relationship]:
        """
        Return all relationships where *element_id* is source **or** target.

        Runs two directional queries and deduplicates by (src, rel_type, tgt).
        """
        try:
            seen: set[tuple[str, str, str]] = set()
            rels: list[Relationship] = []

            with self._driver.session(database=self._db) as s:
                # Outgoing
                for r in s.run(
                    "MATCH (a:Element {id: $id})-[r]->(b:Element) "
                    "RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    "       r.confidence AS conf, r.evidence AS ev",
                    id=element_id,
                ):
                    key = (r["src"], r["rtype"], r["tgt"])
                    if key not in seen:
                        seen.add(key)
                        rels.append(self._record_to_relationship(r))

                # Incoming
                for r in s.run(
                    "MATCH (a:Element)-[r]->(b:Element {id: $id}) "
                    "RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    "       r.confidence AS conf, r.evidence AS ev",
                    id=element_id,
                ):
                    key = (r["src"], r["rtype"], r["tgt"])
                    if key not in seen:
                        seen.add(key)
                        rels.append(self._record_to_relationship(r))

            return rels
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch relationships for '{element_id}': {exc}"
            ) from exc

    def get_incoming_relationships(
        self,
        element_id: str,
        rel_type: Optional[RelationshipType] = None,
    ) -> list[Relationship]:
        """Return relationships where *element_id* is the **target**."""
        try:
            if rel_type is not None:
                query = (
                    f"MATCH (a:Element)-[r:{rel_type.value}]->(b:Element {{id: $id}}) "
                    f"RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    f"       r.confidence AS conf, r.evidence AS ev"
                )
            else:
                query = (
                    "MATCH (a:Element)-[r]->(b:Element {id: $id}) "
                    "RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    "       r.confidence AS conf, r.evidence AS ev"
                )
            with self._driver.session(database=self._db) as s:
                result = s.run(query, id=element_id)
                return [self._record_to_relationship(r) for r in result]
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch incoming relationships for '{element_id}': {exc}"
            ) from exc

    def get_outgoing_relationships(
        self,
        element_id: str,
        rel_type: Optional[RelationshipType] = None,
    ) -> list[Relationship]:
        """Return relationships where *element_id* is the **source**."""
        try:
            if rel_type is not None:
                query = (
                    f"MATCH (a:Element {{id: $id}})-[r:{rel_type.value}]->(b:Element) "
                    f"RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    f"       r.confidence AS conf, r.evidence AS ev"
                )
            else:
                query = (
                    "MATCH (a:Element {id: $id})-[r]->(b:Element) "
                    "RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
                    "       r.confidence AS conf, r.evidence AS ev"
                )
            with self._driver.session(database=self._db) as s:
                result = s.run(query, id=element_id)
                return [self._record_to_relationship(r) for r in result]
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch outgoing relationships for '{element_id}': {exc}"
            ) from exc

    def get_type_counts(self) -> dict[str, int]:
        """Return {type_value: count} for all Element nodes — useful for diagnostics."""
        try:
            with self._driver.session(database=self._db) as s:
                result = s.run(
                    "MATCH (e:Element) RETURN e.type AS t, count(e) AS cnt"
                )
                return {r["t"]: r["cnt"] for r in result}
        except Exception:
            return {}

    def get_document_hashes(self) -> dict[str, str]:
        """Return {doc_id: file_hash} for all Document nodes that have a stored hash."""
        try:
            with self._driver.session(database=self._db) as s:
                result = s.run(
                    "MATCH (e:Element {type: 'Document'}) "
                    "WHERE e.doc_hash IS NOT NULL AND e.doc_hash <> '' "
                    "RETURN e.id AS doc_id, e.doc_hash AS doc_hash"
                )
                return {r["doc_id"]: r["doc_hash"] for r in result}
        except Exception as exc:
            raise GraphStoreError(f"Failed to fetch document hashes: {exc}") from exc

    def clear(self) -> None:
        """Delete every node and relationship in the configured database."""
        try:
            with self._driver.session(database=self._db) as s:
                s.run("MATCH (n) DETACH DELETE n")
        except Exception as exc:
            raise GraphStoreError(f"Failed to clear graph: {exc}") from exc

    def clear_document(self, document_id: str) -> None:
        """Remove all elements (and their relationships) belonging to *document_id*.

        Used for incremental re-ingestion: wipes only the document being
        replaced so other documents in the graph are preserved.
        """
        try:
            with self._driver.session(database=self._db) as s:
                s.run(
                    "MATCH (e:Element {document_id: $did}) DETACH DELETE e",
                    did=document_id,
                )
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to clear document '{document_id}': {exc}"
            ) from exc

    def get_graph_for_visualization(self) -> dict:
        """
        Return a ``{"nodes": [...], "edges": [...]}`` dict suitable for
        rendering with pyvis or any JavaScript graph library.
        """
        nodes_query = (
            "MATCH (e:Element) "
            "RETURN e.id AS id, e.type AS type, e.text AS text, "
            "       e.source AS source, e.document_id AS doc_id"
        )
        edges_query = (
            "MATCH (a:Element)-[r]->(b:Element) "
            "RETURN a.id AS src, type(r) AS rtype, b.id AS tgt, "
            "       r.confidence AS conf, coalesce(r.evidence, '') AS ev"
        )
        try:
            with self._driver.session(database=self._db) as s:
                nodes = [dict(r) for r in s.run(nodes_query)]
                edges = [dict(r) for r in s.run(edges_query)]
            return {"nodes": nodes, "edges": edges}
        except Exception as exc:
            raise GraphStoreError(
                f"Failed to fetch graph for visualization: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def node_count(self) -> int:
        """Total number of Element nodes currently in the store."""
        with self._driver.session(database=self._db) as s:
            result = s.run("MATCH (e:Element) RETURN count(e) AS cnt")
            return result.single()["cnt"]

    @property
    def edge_count(self) -> int:
        """Total number of directed relationships currently in the store."""
        with self._driver.session(database=self._db) as s:
            result = s.run("MATCH ()-[r]->() RETURN count(r) AS cnt")
            return result.single()["cnt"]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _node_to_element(self, node: object) -> AtomicElement:
        """
        Map a neo4j :class:`~neo4j.graph.Node` to an :class:`AtomicElement`.

        Unknown ``type`` values fall back to ``ElementType.REQUIREMENT`` so
        that "Document" pseudo-nodes (written directly by :class:`GraphBuilder`)
        are still parseable without crashing.
        """
        props = dict(node)  # type: ignore[call-overload]
        raw_type = props.get("type", "")
        try:
            elem_type = ElementType(raw_type)
        except ValueError:
            # "Document" and any other ad-hoc label not in ElementType
            elem_type = ElementType.REQUIREMENT

        # metadata is stored as a string representation; parse safely
        raw_meta = props.get("metadata", "{}")
        try:
            import ast
            metadata: dict = ast.literal_eval(raw_meta) if raw_meta else {}
        except Exception:
            metadata = {}

        # Populate section/page_number from dedicated indexed node properties
        # (these override anything that may have been serialised in the metadata string)
        if props.get("section"):
            metadata["section"] = props["section"]
        if props.get("page_number") is not None:
            metadata["page_number"] = props["page_number"]

        return AtomicElement(
            id=props["id"],
            type=elem_type,
            text=props.get("text", ""),
            source=props.get("source", ""),
            document_id=props.get("document_id", ""),
            confidence=float(props.get("confidence", 1.0)),
            metadata=metadata,
        )

    @staticmethod
    def _record_to_relationship(record: object) -> Relationship:
        """Map a query result record to a :class:`Relationship`."""
        r = dict(record)  # type: ignore[call-overload]
        raw_type = r.get("rtype", "")
        try:
            rel_type = RelationshipType(raw_type)
        except ValueError:
            rel_type = RelationshipType.CONTAINS

        return Relationship(
            source_id=r["src"],
            target_id=r["tgt"],
            type=rel_type,
            confidence=float(r.get("conf") or 1.0),
            evidence=r.get("ev") or "",
        )
