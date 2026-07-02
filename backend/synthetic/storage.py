"""
Artifact storage abstraction for the Synthetic Data Studio.

Two interchangeable backends behind one interface:

* :class:`S3ArtifactStore`    — MinIO / S3 (the default; ``SYNTHETIC_STORAGE_BACKEND=s3``)
* :class:`LocalArtifactStore` — filesystem fallback (``=local``), zero infra

Raw dataset artifacts (records JSONL, rendered composite documents) live here;
structured metadata lives in Postgres. Keys are POSIX-style paths, e.g.
``{project_id}/{dataset_id}/v{n}/records.jsonl``.
"""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any, List, Protocol

from config.settings import settings

logger = logging.getLogger(__name__)


class ArtifactStore(Protocol):
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str: ...
    def get_bytes(self, key: str) -> bytes: ...
    def put_text(self, key: str, text: str, content_type: str = "text/plain") -> str: ...
    def put_json(self, key: str, obj: Any) -> str: ...
    def get_json(self, key: str) -> Any: ...
    def list(self, prefix: str) -> List[str]: ...
    def delete_prefix(self, prefix: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def uri(self, key: str) -> str: ...


# ---------------------------------------------------------------------------
# S3 / MinIO backend
# ---------------------------------------------------------------------------


class S3ArtifactStore:
    """S3-compatible backend (defaults to the MinIO container in docker-compose)."""

    def __init__(self) -> None:
        try:
            import boto3
            from botocore.client import Config
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "boto3 is required for the S3 artifact backend. "
                "Install it or set SYNTHETIC_STORAGE_BACKEND=local."
            ) from exc

        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(signature_version="s3v4"),
            region_name=settings.s3_region,
        )
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            existing = [b["Name"] for b in self._client.list_buckets().get("Buckets", [])]
            if self._bucket not in existing:
                self._client.create_bucket(Bucket=self._bucket)
        except Exception as exc:  # pragma: no cover - network/permission dependent
            logger.warning("Could not ensure S3 bucket '%s': %s", self._bucket, exc)

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)
        return self.uri(key)

    def get_bytes(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def put_text(self, key: str, text: str, content_type: str = "text/plain") -> str:
        return self.put_bytes(key, text.encode("utf-8"), content_type)

    def put_json(self, key: str, obj: Any) -> str:
        return self.put_bytes(
            key, json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8"), "application/json"
        )

    def get_json(self, key: str) -> Any:
        return json.loads(self.get_bytes(key).decode("utf-8"))

    def list(self, prefix: str) -> List[str]:
        paginator = self._client.get_paginator("list_objects_v2")
        keys: List[str] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(o["Key"] for o in page.get("Contents", []))
        return keys

    def delete_prefix(self, prefix: str) -> None:
        keys = self.list(prefix)
        if not keys:
            return
        self._client.delete_objects(
            Bucket=self._bucket,
            Delete={"Objects": [{"Key": k} for k in keys]},
        )

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def uri(self, key: str) -> str:
        return f"s3://{self._bucket}/{key}"


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------


class LocalArtifactStore:
    """Filesystem backend — writes under ``settings.synthetic_local_root``."""

    def __init__(self) -> None:
        self._root = Path(settings.synthetic_local_root)
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = self._root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._path(key).write_bytes(data)
        return self.uri(key)

    def get_bytes(self, key: str) -> bytes:
        return (self._root / key).read_bytes()

    def put_text(self, key: str, text: str, content_type: str = "text/plain") -> str:
        self._path(key).write_text(text, encoding="utf-8")
        return self.uri(key)

    def put_json(self, key: str, obj: Any) -> str:
        return self.put_text(key, json.dumps(obj, ensure_ascii=False, indent=2))

    def get_json(self, key: str) -> Any:
        return json.loads((self._root / key).read_text(encoding="utf-8"))

    def list(self, prefix: str) -> List[str]:
        base = self._root / prefix
        search_root = base if base.is_dir() else base.parent
        if not search_root.exists():
            return []
        out: List[str] = []
        for p in search_root.rglob("*"):
            if p.is_file():
                rel = p.relative_to(self._root).as_posix()
                if rel.startswith(prefix):
                    out.append(rel)
        return out

    def delete_prefix(self, prefix: str) -> None:
        base = self._root / prefix
        if base.is_dir():
            shutil.rmtree(base, ignore_errors=True)
        elif base.exists():
            base.unlink()

    def exists(self, key: str) -> bool:
        return (self._root / key).exists()

    def uri(self, key: str) -> str:
        return (self._root / key).as_uri()


_store: ArtifactStore | None = None


def get_artifact_store() -> ArtifactStore:
    """Module-level singleton chosen by ``SYNTHETIC_STORAGE_BACKEND``."""
    global _store
    if _store is None:
        backend = settings.synthetic_storage_backend.lower()
        if backend == "local":
            _store = LocalArtifactStore()
            logger.info("Synthetic artifact store: local (%s)", settings.synthetic_local_root)
        else:
            try:
                _store = S3ArtifactStore()
                logger.info("Synthetic artifact store: s3/minio (%s)", settings.s3_endpoint_url)
            except Exception as exc:
                logger.warning("S3 artifact store unavailable (%s) — falling back to local", exc)
                _store = LocalArtifactStore()
    return _store
