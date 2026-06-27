"""
Abstract base classes (ABCs) that define the contracts every concrete
implementation in this project must fulfill.

Design principles:
- All ABCs use only types defined in :mod:`core.models`; no external
  dependencies are imported here.
- Method signatures use ``BinaryIO`` for file handles so that parsers work
  with real files, in-memory buffers (``io.BytesIO``), and HTTP response
  streams without modification.
- The ``|`` union syntax requires Python 3.10+. For 3.9 compatibility the
  ``Optional`` form is used where None is a valid return.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import BinaryIO, List, Optional

from .models import (
    AtomicElement,
    CoverageResult,
    ExtractionResult,
    KnowledgeGraph,
    ParsedDocument,
    Relationship,
)


# ---------------------------------------------------------------------------
# Document parsing
# ---------------------------------------------------------------------------


class IParser(ABC):
    """
    Converts a raw binary file stream into a :class:`~core.models.ParsedDocument`.

    Implementations are responsible for text extraction only — no NLP,
    no element tagging.  One implementation per file format is expected
    (e.g. ``PDFParser``, ``DocxParser``).
    """

    @abstractmethod
    def parse(self, file: BinaryIO, filename: str) -> ParsedDocument:
        """
        Read *file* and return a structured :class:`~core.models.ParsedDocument`.

        Parameters
        ----------
        file:
            Open binary stream positioned at the start of the document.
        filename:
            Original filename including extension; used to derive document
            type and display name.

        Returns
        -------
        ParsedDocument
            Fully populated document object with one page-text entry per page.

        Raises
        ------
        core.exceptions.ParseError
            If the file cannot be read or is structurally invalid.
        """
        ...

    @abstractmethod
    def supports(self, filename: str) -> bool:
        """
        Return ``True`` if this parser can handle the given *filename*.

        The check is based on the file extension only; the file need not
        exist on disk.

        Parameters
        ----------
        filename:
            Filename (with or without path) to test.
        """
        ...


# ---------------------------------------------------------------------------
# LLM-driven element and relationship extraction
# ---------------------------------------------------------------------------


class IExtractor(ABC):
    """
    Drives an LLM to extract typed :class:`~core.models.AtomicElement` nodes
    and :class:`~core.models.Relationship` edges from parsed documents.

    Implementations are expected to handle chunking, prompt construction,
    and response parsing internally.  Callers interact only through the two
    methods below.
    """

    @abstractmethod
    def extract_elements(self, doc: ParsedDocument) -> List[AtomicElement]:
        """
        Extract all atomic elements from *doc*.

        Parameters
        ----------
        doc:
            A fully parsed document as produced by an :class:`IParser`.

        Returns
        -------
        list of AtomicElement
            Extracted elements with ``document_id``, ``type``, ``text``,
            ``source``, and ``confidence`` populated.  ``embedding`` is
            intentionally left as ``None`` here; the vector-store layer
            fills it in.

        Raises
        ------
        core.exceptions.ExtractionError
            If the LLM call fails or the response cannot be parsed.
        """
        ...

    @abstractmethod
    def extract_relationships(self, elements: List[AtomicElement]) -> List[Relationship]:
        """
        Infer typed relationships between *elements*.

        Parameters
        ----------
        elements:
            The full set of elements extracted from one or more documents.
            Implementations may filter internally (e.g. only consider
            cross-type pairs relevant to the relationship vocabulary).

        Returns
        -------
        list of Relationship
            Each relationship carries ``source_id``, ``target_id``,
            ``type``, ``confidence``, and a natural-language ``evidence``
            string.

        Raises
        ------
        core.exceptions.ExtractionError
            If the LLM call fails or the response cannot be parsed.
        """
        ...


# ---------------------------------------------------------------------------
# Graph persistence
# ---------------------------------------------------------------------------


class IGraphStore(ABC):
    """
    Persistent store for :class:`~core.models.AtomicElement` nodes and
    :class:`~core.models.Relationship` edges.

    This is the *structural* half of storage (graph topology).  Semantic
    / vector search is handled separately by :class:`IVectorStore`.

    Implementations must be safe to call from a single thread; concurrent
    access is not required at this POC stage.
    """

    @abstractmethod
    def add_element(self, element: AtomicElement) -> None:
        """
        Insert or update *element* in the store.

        If an element with the same ``id`` already exists it should be
        replaced (upsert semantics).

        Raises
        ------
        core.exceptions.GraphStoreError
            On any persistence failure.
        """
        ...

    @abstractmethod
    def add_relationship(self, rel: Relationship) -> None:
        """
        Persist *rel*.

        Duplicate relationships (same ``source_id``, ``target_id``, and
        ``type``) should be silently ignored or upserted.

        Raises
        ------
        core.exceptions.GraphStoreError
            On any persistence failure.
        """
        ...

    @abstractmethod
    def get_element(self, element_id: str) -> Optional[AtomicElement]:
        """
        Return the element with *element_id*, or ``None`` if not found.

        Raises
        ------
        core.exceptions.GraphStoreError
            On any retrieval failure (distinct from "not found").
        """
        ...

    @abstractmethod
    def get_all_elements(self) -> List[AtomicElement]:
        """Return every element currently in the store."""
        ...

    @abstractmethod
    def get_relationships(self, element_id: str) -> List[Relationship]:
        """
        Return all relationships where *element_id* appears as either
        ``source_id`` or ``target_id``.
        """
        ...

    @abstractmethod
    def clear(self) -> None:
        """
        Remove all elements and relationships from the store.

        Use with caution; intended for testing and full re-ingestion.
        """
        ...


# ---------------------------------------------------------------------------
# Vector / semantic search
# ---------------------------------------------------------------------------


class IVectorStore(ABC):
    """
    Semantic search layer backed by a vector embedding index.

    Embeddings are generated internally by the implementation (e.g. using
    ``sentence-transformers``).  Callers pass raw :class:`~core.models.AtomicElement`
    objects; the implementation is responsible for encoding and indexing.
    """

    @abstractmethod
    def upsert(self, elements: List[AtomicElement]) -> None:
        """
        Encode and index *elements*, replacing any existing entries with
        the same ``id``.

        This method also populates ``element.embedding`` on each object so
        that callers have access to the vector if needed.

        Parameters
        ----------
        elements:
            Elements to index.  ``text`` is used as the input to the
            embedding model.

        Raises
        ------
        core.exceptions.VectorStoreError
            On any embedding or indexing failure.
        """
        ...

    @abstractmethod
    def search(self, query: str, n_results: int = 5) -> List[AtomicElement]:
        """
        Return up to *n_results* elements whose embeddings are most
        semantically similar to *query*.

        Parameters
        ----------
        query:
            Natural-language query string.
        n_results:
            Maximum number of results to return.

        Returns
        -------
        list of AtomicElement
            Results ordered by descending similarity.  The returned objects
            are the same instances stored via :meth:`upsert` (not copies).

        Raises
        ------
        core.exceptions.VectorStoreError
            On any retrieval failure.
        """
        ...

    @abstractmethod
    def clear(self) -> None:
        """
        Drop all vectors from the index.

        Use with caution; intended for testing and full re-ingestion.
        """
        ...
