"""
Graphiti-core integration for semantic episode-based graph memory.

Each document page is stored as a Graphiti *episode*.  Graphiti extracts
entities and relationships autonomously using GPT-4o (or the configured LLM),
building a second semantic layer that complements the typed structural graph
maintained by :class:`~graph.neo4j_store.Neo4jGraphStore`.

The public API mirrors the structural store:

* ``ingest_document_sync`` / ``ingest_document`` — add document pages
* ``search_graph_sync`` / ``search_graph``       — semantic fact search
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from graphiti_core import Graphiti
from graphiti_core.nodes import EpisodeType

from config.settings import settings
from core.models import AtomicElement, ParsedDocument

logger = logging.getLogger(__name__)


class GraphitiMemory:
    """
    Wraps Graphiti to provide semantic episode ingestion and entity search.

    Each document chunk is stored as an episode.  Graphiti extracts entities
    and relationships autonomously using GPT-4o, complementing our typed
    schema.

    The client is initialised lazily on first use so that importing this
    module does not require an active Neo4j connection.
    """

    def __init__(self) -> None:
        self._client: Graphiti | None = None  # lazy initialisation

    # ------------------------------------------------------------------
    # Async public API
    # ------------------------------------------------------------------

    async def _get_client(self) -> Graphiti:
        """Return (creating if necessary) the shared Graphiti client."""
        if self._client is None:
            self._client = Graphiti(
                settings.neo4j_uri,
                settings.neo4j_user,
                settings.neo4j_password,
            )
            await self._client.build_indices_and_constraints()
        return self._client

    async def ingest_document(
        self,
        doc: ParsedDocument,
        elements: list[AtomicElement],
    ) -> None:
        """
        Ingest document pages as episodes into Graphiti graph memory.

        Pages shorter than 50 characters (blank/header-only pages) are
        silently skipped to avoid polluting the episode graph with noise.

        Parameters
        ----------
        doc:
            The parsed document whose pages will be ingested.
        elements:
            The typed elements already extracted from *doc*.  Passed here
            so that future implementations can seed Graphiti with pre-known
            entity hints; currently not used directly.
        """
        client = await self._get_client()
        for i, page_text in enumerate(doc.pages):
            if len(page_text.strip()) < 50:
                continue
            await client.add_episode(
                name=f"{doc.name} — Page {i + 1}",
                episode_body=page_text,
                source=EpisodeType.text,
                source_description=(
                    f"{doc.type.value} document: {doc.name}"
                ),
            )

    async def search_graph(
        self,
        query: str,
        num_results: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Semantic search over Graphiti's entity graph.

        Parameters
        ----------
        query:
            Natural-language query string.
        num_results:
            Maximum number of facts to return.

        Returns
        -------
        list of dict
            Each dict has keys ``"fact"``, ``"uuid"``, and ``"valid_at"``.
        """
        client = await self._get_client()
        results = await client.search(query, num_results=num_results)
        return [
            {
                "fact": r.fact,
                "uuid": r.uuid,
                "valid_at": str(r.valid_at),
            }
            for r in results
        ]

    # ------------------------------------------------------------------
    # Sync wrappers for Streamlit
    # ------------------------------------------------------------------

    def ingest_document_sync(
        self,
        doc: ParsedDocument,
        elements: list[AtomicElement],
    ) -> None:
        """
        Synchronous wrapper around :meth:`ingest_document`.

        Streamlit runs in a context where an event loop may already be
        active (e.g. inside ``asyncio.run`` from a prior call or within
        a Tornado/uvicorn loop).  This method handles both cases:

        * If a running loop exists → offload to a ``ThreadPoolExecutor``
          that runs ``asyncio.run`` in a fresh OS thread.
        * Otherwise → call ``loop.run_until_complete`` directly.

        Failures are caught and logged as warnings rather than raised, so
        that Graphiti enrichment failures do not block the core POC flow.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(
                        asyncio.run, self.ingest_document(doc, elements)
                    )
                    future.result(timeout=120)
            else:
                loop.run_until_complete(self.ingest_document(doc, elements))
        except Exception as exc:
            logger.warning("[GraphitiMemory] Ingest warning: %s", exc)

    def search_graph_sync(
        self,
        query: str,
        num_results: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Synchronous wrapper around :meth:`search_graph`.

        Returns an empty list on failure so callers can treat absent
        Graphiti results as a graceful degradation.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(
                        asyncio.run, self.search_graph(query, num_results)
                    )
                    return future.result(timeout=30)
            else:
                return loop.run_until_complete(
                    self.search_graph(query, num_results)
                )
        except Exception as exc:
            logger.warning("[GraphitiMemory] Search warning: %s", exc)
            return []
