"""
Centralized configuration for the GraphRAG POC application.
All settings are read from environment variables with sensible defaults.
Uses python-dotenv to load from a .env file if present.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path)
except ImportError:
    pass


@dataclass(frozen=True)
class Settings:
    """Immutable settings object. Instantiate once and reuse."""

    # --- OpenAI / LLM ---
    openai_api_key: str = field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY", "")
    )
    llm_model: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL", "gpt-4o")
    )
    max_tokens_extraction: int = field(
        default_factory=lambda: int(os.environ.get("MAX_TOKENS_EXTRACTION", "4000"))
    )

    # --- Embeddings ---
    embedding_model: str = field(
        default_factory=lambda: os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3")
    )
    embedding_dimension: int = field(
        default_factory=lambda: int(os.environ.get("EMBEDDING_DIMENSION", "1024"))
    )

    # --- Qdrant Vector Store ---
    qdrant_host: str = field(
        default_factory=lambda: os.environ.get("QDRANT_HOST", "localhost")
    )
    qdrant_port: int = field(
        default_factory=lambda: int(os.environ.get("QDRANT_PORT", "6333"))
    )
    qdrant_collection: str = field(
        default_factory=lambda: os.environ.get("QDRANT_COLLECTION", "graphrag_elements")
    )
    qdrant_api_key: str = field(
        default_factory=lambda: os.environ.get("QDRANT_API_KEY", "")
    )

    # --- Neo4j Graph Store ---
    neo4j_uri: str = field(
        default_factory=lambda: os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    )
    neo4j_user: str = field(
        default_factory=lambda: os.environ.get("NEO4J_USER", "neo4j")
    )
    neo4j_password: str = field(
        default_factory=lambda: os.environ.get("NEO4J_PASSWORD", "password")
    )
    neo4j_database: str = field(
        default_factory=lambda: os.environ.get("NEO4J_DATABASE", "neo4j")
    )

    # --- PostgreSQL (workspace metadata) ---
    postgres_url: str = field(
        default_factory=lambda: os.environ.get(
            "POSTGRES_URL",
            "postgresql://graphrag:graphrag@localhost:5432/graphrag",
        )
    )

    # --- Quality thresholds ---
    confidence_threshold: float = field(
        default_factory=lambda: float(os.environ.get("CONFIDENCE_THRESHOLD", "0.5"))
    )

    # --- Synthetic Data Studio ---
    # Artifact storage backend: "s3" (MinIO/S3) or "local" (filesystem fallback).
    synthetic_storage_backend: str = field(
        default_factory=lambda: os.environ.get("SYNTHETIC_STORAGE_BACKEND", "s3")
    )
    synthetic_local_root: str = field(
        default_factory=lambda: os.environ.get(
            "SYNTHETIC_LOCAL_ROOT",
            str(Path(__file__).resolve().parent.parent.parent / "storage" / "synthetic"),
        )
    )
    # S3 / MinIO
    s3_endpoint_url: str = field(
        default_factory=lambda: os.environ.get("S3_ENDPOINT_URL", "http://localhost:9000")
    )
    s3_bucket: str = field(
        default_factory=lambda: os.environ.get("S3_BUCKET", "synthetic")
    )
    s3_access_key: str = field(
        default_factory=lambda: os.environ.get("S3_ACCESS_KEY", "minioadmin")
    )
    s3_secret_key: str = field(
        default_factory=lambda: os.environ.get("S3_SECRET_KEY", "minioadmin")
    )
    s3_region: str = field(
        default_factory=lambda: os.environ.get("S3_REGION", "us-east-1")
    )
    # Qdrant collection dedicated to synthetic-record duplicate detection
    synthetic_qdrant_collection: str = field(
        default_factory=lambda: os.environ.get("SYNTHETIC_QDRANT_COLLECTION", "synthetic_elements")
    )
    # Minimum examples required per matrix cell before a cell is "sufficient"
    synthetic_min_threshold: int = field(
        default_factory=lambda: int(os.environ.get("SYNTHETIC_MIN_THRESHOLD", "5"))
    )
    # Duplicate-detection cosine-similarity thresholds
    synthetic_dup_exact: float = field(
        default_factory=lambda: float(os.environ.get("SYNTHETIC_DUP_EXACT", "0.97"))
    )
    synthetic_dup_near: float = field(
        default_factory=lambda: float(os.environ.get("SYNTHETIC_DUP_NEAR", "0.90"))
    )
    # Realism score below this (0-1) flags a record for regeneration
    synthetic_realism_floor: float = field(
        default_factory=lambda: float(os.environ.get("SYNTHETIC_REALISM_FLOOR", "0.6"))
    )
    # Max regeneration attempts per requested record during a generate run
    synthetic_max_regen: int = field(
        default_factory=lambda: int(os.environ.get("SYNTHETIC_MAX_REGEN", "2"))
    )

    # --- Logging ---
    log_level: str = field(
        default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO")
    )

    # --- Document processing ---
    max_chunk_chars: int = field(
        default_factory=lambda: int(os.environ.get("MAX_CHUNK_CHARS", "3000"))
    )
    chunk_overlap_chars: int = field(
        default_factory=lambda: int(os.environ.get("CHUNK_OVERLAP_CHARS", "200"))
    )

    def validate(self) -> None:
        """Raise ValueError for any critical mis-configuration."""
        if not self.openai_api_key:
            raise ValueError(
                "OPENAI_API_KEY is not set. "
                "Add it to your .env file or export it as an environment variable."
            )
        if not (0.0 <= self.confidence_threshold <= 1.0):
            raise ValueError(
                f"CONFIDENCE_THRESHOLD must be between 0 and 1, got {self.confidence_threshold}"
            )
        if self.max_tokens_extraction <= 0:
            raise ValueError(
                f"MAX_TOKENS_EXTRACTION must be positive, got {self.max_tokens_extraction}"
            )


# Module-level singleton — import with: from config.settings import settings
settings = Settings()
