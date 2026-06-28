"""
Qdrant-backed vector store — accepts a per-workspace collection name.
"""
from __future__ import annotations

from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams,
)

from config.settings import settings
from core.exceptions import VectorStoreError
from core.interfaces import IVectorStore
from core.models import AtomicElement, ElementType
from .embedder import BGEEmbedder


class QdrantVectorStore(IVectorStore):
    def __init__(
        self,
        collection_name: Optional[str] = None,
        embedder: Optional[BGEEmbedder] = None,
    ) -> None:
        self._embedder: BGEEmbedder = embedder or BGEEmbedder()
        api_key = settings.qdrant_api_key or None
        self._client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=api_key,
        )
        self._collection: str = collection_name or settings.qdrant_collection
        self._cache: dict[str, AtomicElement] = {}
        self._ensure_collection()

    def _ensure_collection(self) -> None:
        try:
            existing = [c.name for c in self._client.get_collections().collections]
            if self._collection not in existing:
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
        return abs(hash(element_id)) % (2 ** 63)

    @staticmethod
    def _payload_to_element(payload: dict) -> AtomicElement:
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

    def upsert(self, elements: list[AtomicElement]) -> None:
        if not elements:
            return
        try:
            vectors = self._embedder.embed([e.text for e in elements])
            points = []
            for elem, vec in zip(elements, vectors):
                elem.embedding = vec
                self._cache[elem.id] = elem
                points.append(PointStruct(
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
                ))
            self._client.upsert(collection_name=self._collection, points=points)
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Upsert failed: {exc}") from exc

    def search(self, query: str, n_results: int = 5) -> list[AtomicElement]:
        try:
            qvec = self._embedder.embed_one(query)
            response = self._client.query_points(
                collection_name=self._collection,
                query=qvec, limit=n_results, with_payload=True,
            )
            results = []
            for hit in response.points:
                elem_id = hit.payload.get("element_id", "")
                results.append(self._cache.get(elem_id) or self._payload_to_element(hit.payload))
            return results
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Search failed: {exc}") from exc

    def search_by_type(
        self, query: str, element_type: ElementType,
        n_results: int = 5, section: Optional[str] = None,
    ) -> list[AtomicElement]:
        try:
            qvec = self._embedder.embed_one(query)
            must = [FieldCondition(key="type", match=MatchValue(value=element_type.value))]
            if section is not None:
                must.append(FieldCondition(key="section", match=MatchValue(value=section)))
            response = self._client.query_points(
                collection_name=self._collection,
                query=qvec, limit=n_results, with_payload=True,
                query_filter=Filter(must=must),
            )
            results = []
            for hit in response.points:
                elem_id = hit.payload.get("element_id", "")
                results.append(self._cache.get(elem_id) or self._payload_to_element(hit.payload))
            return results
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Search by type failed: {exc}") from exc

    def clear(self) -> None:
        try:
            self._client.delete_collection(self._collection)
            self._cache.clear()
            self._ensure_collection()
        except VectorStoreError:
            raise
        except Exception as exc:
            raise VectorStoreError(f"Clear failed: {exc}") from exc
