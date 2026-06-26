"""
BGE-M3 embedder backed by sentence-transformers.

The underlying SentenceTransformer model is loaded lazily on the first call
to :meth:`embed` or :meth:`embed_one`, so import time stays fast even when
the model weights are not yet cached locally.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sentence_transformers import SentenceTransformer

from config.settings import settings

if TYPE_CHECKING:
    import numpy as np


class BGEEmbedder:
    """Lazy-loading BAAI/bge-m3 embedder.

    The model is downloaded from HuggingFace Hub and cached to the local
    sentence-transformers cache directory on first use.  Subsequent
    instantiations that share the same process benefit from the in-process
    model cache managed by sentence-transformers.
    """

    def __init__(self) -> None:
        self._model: SentenceTransformer | None = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Ensure the model is loaded exactly once per instance."""
        if self._model is None:
            self._model = SentenceTransformer(settings.embedding_model)

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return L2-normalised dense embeddings for a batch of *texts*.

        Parameters
        ----------
        texts:
            Non-empty list of strings to encode.

        Returns
        -------
        list[list[float]]
            One embedding vector per input text.  Each vector has length
            :attr:`dimension`.
        """
        self._load()
        assert self._model is not None  # narrowing for type checkers
        vecs = self._model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=32,
        )
        return vecs.tolist()

    def embed_one(self, text: str) -> list[float]:
        """Convenience wrapper: embed a single string and return its vector."""
        return self.embed([text])[0]

    @property
    def dimension(self) -> int:
        """Configured embedding dimension (default 1024 for bge-m3)."""
        return settings.embedding_dimension
