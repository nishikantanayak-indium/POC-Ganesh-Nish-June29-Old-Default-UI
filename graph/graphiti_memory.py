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

    def _run_async(self, coro, timeout: int = 120) -> Any:
        """
        Safely run *coro* from any synchronous context.

        Streamlit's ScriptRunner thread has no event loop.
        ``asyncio.get_event_loop()`` raises ``DeprecationWarning`` in
        Python 3.10+ and ``RuntimeError`` in 3.12+ when called from a
        non-main thread without an existing loop.

        Strategy:
        * Try ``asyncio.get_running_loop()`` — raises ``RuntimeError`` when
          there is no running loop (the normal Streamlit case).
        * No running loop → ``asyncio.run()`` creates a fresh loop, runs
          the coroutine, and tears the loop down cleanly.
        * Running loop (e.g. Jupyter) → offload to a thread so we never
          nest ``asyncio.run`` inside a running loop.

        The Graphiti client is reset before each call because it is bound
        to the event loop that created it; reusing it across loops raises
        ``RuntimeError: Event loop is closed``.
        """
        import concurrent.futures

        try:
            asyncio.get_running_loop()
            # There IS a running loop — run in a worker thread with its own loop
            self._client = None
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result(timeout=timeout)
        except RuntimeError:
            # No running loop — safe to use asyncio.run() directly
            self._client = None
            return asyncio.run(coro)

    def ingest_document_sync(
        self,
        doc: ParsedDocument,
        elements: list[AtomicElement],
    ) -> None:
        """Synchronous wrapper around :meth:`ingest_document`.

        Failures are caught and logged as warnings so that Graphiti
        enrichment failures do not block the core POC flow.
        """
        try:
            self._run_async(self.ingest_document(doc, elements), timeout=120)
        except Exception as exc:
            logger.warning("[GraphitiMemory] Ingest warning: %s", exc)

    def search_graph_sync(
        self,
        query: str,
        num_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Synchronous wrapper around :meth:`search_graph`.

        Returns an empty list on failure so callers treat absent Graphiti
        results as graceful degradation rather than an error.
        """
        try:
            return self._run_async(
                self.search_graph(query, num_results), timeout=30
            )
        except Exception as exc:
            logger.warning("[GraphitiMemory] Search warning: %s", exc)
            return []
