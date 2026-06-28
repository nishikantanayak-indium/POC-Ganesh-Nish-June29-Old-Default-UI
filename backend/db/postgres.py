"""
Workspace persistence — PostgreSQL via psycopg2.

All functions are synchronous; wrap in asyncio.to_thread for async routes.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.extras

from config.settings import settings


@dataclass
class Workspace:
    id: str
    name: str
    description: str
    created_at: datetime
    updated_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


_db_ready = False


def _conn():
    return psycopg2.connect(settings.postgres_url)


def init_db() -> None:
    global _db_ready
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
                id          TEXT        PRIMARY KEY,
                name        TEXT        NOT NULL,
                description TEXT        NOT NULL DEFAULT '',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()
    _db_ready = True


def _ensure_init() -> None:
    if not _db_ready:
        init_db()


def list_workspaces() -> list[Workspace]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM workspaces ORDER BY updated_at DESC")
        return [Workspace(**dict(row)) for row in cur.fetchall()]


def get_workspace(workspace_id: str) -> Optional[Workspace]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM workspaces WHERE id = %s", (workspace_id,))
        row = cur.fetchone()
        return Workspace(**dict(row)) if row else None


def create_workspace(name: str, description: str = "") -> Workspace:
    _ensure_init()
    wid = str(uuid.uuid4())
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "INSERT INTO workspaces (id, name, description) VALUES (%s, %s, %s) RETURNING *",
            (wid, name.strip(), description.strip()),
        )
        row = cur.fetchone()
        conn.commit()
        return Workspace(**dict(row))


def update_workspace(workspace_id: str, name: str, description: str) -> Optional[Workspace]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "UPDATE workspaces SET name=%s, description=%s, updated_at=NOW() "
            "WHERE id=%s RETURNING *",
            (name.strip(), description.strip(), workspace_id),
        )
        row = cur.fetchone()
        conn.commit()
        return Workspace(**dict(row)) if row else None


def delete_workspace(workspace_id: str) -> bool:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM workspaces WHERE id = %s", (workspace_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        return deleted
