"""
Qdrant-backed implementation of :class:`core.interfaces.IVectorStore`.

Design notes
------------
- The collection is created automatically on first instantiation if it does
  not already exist (``_ensure_collection``).
- Qdrant point IDs are ``uint64``; Python string IDs are converted via a
  deterministic hash (``_elem_to_id``).  Collisions are astronomically
  unlikely for a POC-scale dataset but should be replaced with a proper UUID
  mapping for production use.
- A lightweight in-memory cache (``_cache``) stores the full
  :class:`~core.models.AtomicElement` objects so that ``search`` can return
  the *same* instance that was upserted rather than reconstructing from the
  Qdrant payload.  This means ``element.embedding`` is always populated on
  cache-hit results.
- The Qdrant payload mirrors every field needed to reconstruct an
  :class:`~core.models.AtomicElement` when the cache is cold (e.g. after a
  process restart).
"""

from __future__ import annotations

from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from config.settings import settings
from core.exceptions import VectorStoreError
from core.interfaces import IVectorStore
from core.models import AtomicElement, ElementType

from .embedder import BGEEmbedder


class QdrantVectorStore(IVectorStore):
    """Semantic vector store backed by Qdrant and BAAI/bge-m3.

    Parameters
    ----------
    embedder:
        Optional pre-constructed :class:`BGEEmbedder`.  When omitted a new
        instance is created (model is loaded lazily on first encode call).
    """

    def __init__(self, embedder: Optional[BGEEmbedder] = None) -> None:
        self._embedder: BGEEmbedder = embedder or BGEEmbedder()
        api_key: Optional[str] = settings.qdrant_api_key if settings.qdrant_api_key else None
        self._client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=api_key,
        )
        self._collection: str = settings.qdrant_collection
        # In-process cache: element_id -> AtomicElement (with embedding set)
        self._cache: dict[str, AtomicElement] = {}
        self._ensure_collection()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_collection(self) -> None:
        """Create the Qdrant collection if it does not already exist."""
        try:
            existing_names = [
                c.name for c in self._client.get_collections().collections
            ]
            if self._collection not in existing_names:
                self._client.create_collection(
                    collection_name=self._collection,
                    vectors_config=VectorParams(
                        size=settings.embedding_dimension,
                        distance=Distance.COSINE,
                    ),
                )
        except Exception as exc:
            raise VectorStoreError(
                f"Failed to ensure Qdrant collection '{self._collection}': {exc}"
            ) from exc

    @staticmethod
    def _elem_to_id(element_id: str) -> int:
        """Map a string element ID to a non-negative ``uint64`` Qdrant point ID."""
        return abs(hash(element_id)) % (2 ** 63)

    @staticmethod
    def _payload_to_element(payload: dict) -> AtomicElement:
        """Reconstruct an :class:`AtomicElement` from a Qdrant point payload."""
        raw_type = payload.get("type", ElementType.REQUIREMENT.value)
        try:
            etype = ElementType(raw_type)
        except ValueError:
            etype = ElementType.REQUIREMENT

        elem = AtomicElement(
            id=payload.get("element_id", ""),
            type=etype,
            text=payload.get("text", ""),
            source=payload.get("source", ""),
            document_id=payload.get("document_id", ""),
            confidence=float(payload.get("confidence", 1.0)),
        )
        elem.metadata["section"] = payload.get("section", "")
        elem.metadata["page_number"] = payload.get("page_number", 0)
        return elem

    # ------------------------------------------------------------------
    # IVectorStore implementation
    # ------------------------------------------------------------------

    def upsert(self, elements: list[AtomicElement]) -> None:
        """Encode *elements* and index them in Qdrant (upsert semantics).

        Also populates ``element.embedding`` on every element so callers
        have immediate access to the dense vector.

        Parameters
        ----------
        elements:
            Elements to encode and store.  An empty list is a no-op.

        Raises
        ------
        VectorStoreError
            If encoding or the Qdrant upsert call fails.
        """
        if not elements:
            return
        try:
            texts: list[str] = [e.text for e in elements]
            vectors: list[list[float]] = self._embedder.embed(texts)

            points: list[PointStruct] = []
            for elem, vec in zip(elements, vectors):
                elem.embedding = vec
                self._cache[elem.id] = elem
                points.append(
                    PointStruct(
                        id=self._elem_to_id(elem.id),
                        vector=vec,
                        payload={
                            "element_id": elem.id,
                            "type": elem.type.value,
                            "text": elem.text,
                            "source": elem.source,
                            "document_id": elem.document_id,
                            "confidence": elem.confidence,
                            "section": elem.metadata.get("section", ""),
                            "page_number": elem.metadata.get("page_number", 0),
                        },
                    )
                )

            self._client.upsert(collection_name=self._collection, points=points)
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Upsert failed: {exc}") from exc

    def search(self, query: str, n_results: int = 5) -> list[AtomicElement]:
        """Return the *n_results* most semantically similar elements to *query*.

        Results are served from the in-memory cache when available so that
        the returned objects carry ``embedding`` and any runtime-added
        ``metadata``.  Cold results (cache miss after process restart) are
        reconstructed from the Qdrant payload.

        Parameters
        ----------
        query:
            Natural-language query string.
        n_results:
            Maximum number of results to return.

        Returns
        -------
        list[AtomicElement]
            Ordered by descending cosine similarity.

        Raises
        ------
        VectorStoreError
            If the embed or search call fails.
        """
        try:
            qvec: list[float] = self._embedder.embed_one(query)
            response = self._client.query_points(
                collection_name=self._collection,
                query=qvec,
                limit=n_results,
                with_payload=True,
            )
            results: list[AtomicElement] = []
            for hit in response.points:
                elem_id: str = hit.payload.get("element_id", "")
                if elem_id in self._cache:
                    results.append(self._cache[elem_id])
                else:
                    results.append(self._payload_to_element(hit.payload))
            return results
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Search failed: {exc}") from exc

    def search_by_type(
        self,
        query: str,
        element_type: ElementType,
        n_results: int = 5,
        section: Optional[str] = None,
    ) -> list[AtomicElement]:
        """Like :meth:`search` but restricted to a single :class:`ElementType`.

        Parameters
        ----------
        section:
            Optional section label to further filter results.  When provided,
            only elements whose ``section`` payload field matches exactly are
            returned.
        """
        try:
            qvec: list[float] = self._embedder.embed_one(query)
            must_conditions = [
                FieldCondition(
                    key="type",
                    match=MatchValue(value=element_type.value),
                )
            ]
            if section is not None:
                must_conditions.append(
                    FieldCondition(
                        key="section",
                        match=MatchValue(value=section),
                    )
                )
            response = self._client.query_points(
                collection_name=self._collection,
                query=qvec,
                limit=n_results,
                with_payload=True,
                query_filter=Filter(must=must_conditions),
            )
            results: list[AtomicElement] = []
            for hit in response.points:
                elem_id: str = hit.payload.get("element_id", "")
                if elem_id in self._cache:
                    results.append(self._cache[elem_id])
                else:
                    results.append(self._payload_to_element(hit.payload))
            return results
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Search by type failed: {exc}") from exc

    def clear(self) -> None:
        """Drop the Qdrant collection and recreate it empty.

        Also clears the in-memory cache.

        Raises
        ------
        VectorStoreError
            If the delete or recreate call fails.
        """
        try:
            self._client.delete_collection(self._collection)
            self._cache.clear()
            self._ensure_collection()
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Clear failed: {exc}") from exc
