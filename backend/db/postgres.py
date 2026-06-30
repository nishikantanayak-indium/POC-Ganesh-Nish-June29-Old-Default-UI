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


@dataclass
class Conversation:
    id: str
    workspace_id: str
    title: str
    created_at: datetime
    updated_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "workspace_id": self.workspace_id,
            "title": self.title,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass
class ConversationMessage:
    id: str
    conversation_id: str
    role: str
    content: str
    query_type: Optional[str]
    evidence: Optional[list]
    created_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "role": self.role,
            "content": self.content,
            "query_type": self.query_type,
            "evidence": self.evidence,
            "created_at": self.created_at.isoformat(),
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id           TEXT        PRIMARY KEY,
                workspace_id TEXT        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                title        TEXT        NOT NULL DEFAULT 'New conversation',
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_conv_workspace
                ON chat_conversations(workspace_id)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id              TEXT        PRIMARY KEY,
                conversation_id TEXT        NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                role            TEXT        NOT NULL,
                content         TEXT        NOT NULL,
                query_type      TEXT,
                evidence        JSONB,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_msg_conversation
                ON chat_messages(conversation_id)
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


# ---------------------------------------------------------------------------
# Chat conversations
# ---------------------------------------------------------------------------

def list_conversations(workspace_id: str) -> list[Conversation]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM chat_conversations WHERE workspace_id = %s ORDER BY updated_at DESC",
            (workspace_id,),
        )
        return [Conversation(**dict(r)) for r in cur.fetchall()]


def get_conversation(conversation_id: str) -> Optional[Conversation]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT * FROM chat_conversations WHERE id = %s", (conversation_id,))
        row = cur.fetchone()
        return Conversation(**dict(row)) if row else None


def create_conversation(workspace_id: str, title: str = "New conversation") -> Conversation:
    _ensure_init()
    cid = str(uuid.uuid4())
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "INSERT INTO chat_conversations (id, workspace_id, title) VALUES (%s, %s, %s) RETURNING *",
            (cid, workspace_id, title),
        )
        row = cur.fetchone()
        conn.commit()
        return Conversation(**dict(row))


def rename_conversation(conversation_id: str, title: str) -> Optional[Conversation]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "UPDATE chat_conversations SET title=%s, updated_at=NOW() WHERE id=%s RETURNING *",
            (title.strip(), conversation_id),
        )
        row = cur.fetchone()
        conn.commit()
        return Conversation(**dict(row)) if row else None


def delete_conversation(conversation_id: str) -> bool:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM chat_conversations WHERE id = %s", (conversation_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        return deleted


# ---------------------------------------------------------------------------
# Chat messages
# ---------------------------------------------------------------------------

def get_messages(conversation_id: str) -> list[ConversationMessage]:
    _ensure_init()
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT * FROM chat_messages WHERE conversation_id = %s ORDER BY created_at ASC",
            (conversation_id,),
        )
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # evidence is returned as a native Python list/dict from JSONB
            result.append(ConversationMessage(
                id=d["id"],
                conversation_id=d["conversation_id"],
                role=d["role"],
                content=d["content"],
                query_type=d.get("query_type"),
                evidence=d.get("evidence"),
                created_at=d["created_at"],
            ))
        return result


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    query_type: Optional[str] = None,
    evidence: Optional[list] = None,
) -> ConversationMessage:
    """Insert a message and bump the conversation's updated_at."""
    _ensure_init()
    import json as _json
    mid = str(uuid.uuid4())
    evidence_json = _json.dumps(evidence) if evidence is not None else None
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "INSERT INTO chat_messages (id, conversation_id, role, content, query_type, evidence) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
            (mid, conversation_id, role, content, query_type, evidence_json),
        )
        row = cur.fetchone()
        cur.execute(
            "UPDATE chat_conversations SET updated_at=NOW() WHERE id=%s",
            (conversation_id,),
        )
        conn.commit()
        d = dict(row)
        return ConversationMessage(
            id=d["id"],
            conversation_id=d["conversation_id"],
            role=d["role"],
            content=d["content"],
            query_type=d.get("query_type"),
            evidence=evidence,  # use original list, not re-parsed JSON
            created_at=d["created_at"],
        )


def count_messages(conversation_id: str) -> int:
    _ensure_init()
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE conversation_id = %s",
            (conversation_id,),
        )
        return cur.fetchone()[0]
