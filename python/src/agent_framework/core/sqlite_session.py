from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from agent_framework.core.contracts import SessionRecord, SessionStore
from agent_framework.core.domain import Message


@dataclass
class SessionSearchHit:
    session_id: str
    message_index: int
    snippet: str


def _message_text(message: Message) -> str:
    return message.content if isinstance(message.content, str) else json.dumps(message.content)


def _serialize_message(message: Message) -> str:
    if isinstance(message.content, str):
        payload = {"role": message.role, "content": message.content}
    else:
        payload = {"role": message.role, "content": [asdict(part) for part in message.content]}
    return json.dumps(payload)


def _deserialize_message(raw: str) -> Message:
    payload = json.loads(raw)
    return Message(role=payload["role"], content=payload["content"])


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  body TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  body,
  content='messages',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, session_id, body) VALUES (new.id, new.session_id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, session_id, body) VALUES ('delete', old.id, old.session_id, old.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, session_id, body) VALUES ('delete', old.id, old.session_id, old.body);
  INSERT INTO messages_fts(rowid, session_id, body) VALUES (new.id, new.session_id, new.body);
END;
"""


class SqliteSessionStore(SessionStore):
    def __init__(self, database_path: str) -> None:
        path = Path(database_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.executescript(SCHEMA)

    async def get(self, session_id: str) -> SessionRecord | None:
        row = self._conn.execute(
            "SELECT id, created_at, updated_at, metadata FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        messages = [
            _deserialize_message(item["content"])
            for item in self._conn.execute(
                "SELECT content FROM messages WHERE session_id = ? ORDER BY seq ASC",
                (session_id,),
            ).fetchall()
        ]
        return SessionRecord(
            id=row["id"],
            messages=messages,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            metadata=json.loads(row["metadata"]) if row["metadata"] else None,
        )

    async def save(self, session: SessionRecord) -> None:
        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                """
                INSERT INTO sessions(id, created_at, updated_at, metadata)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, metadata = excluded.metadata
                """,
                (
                    session.id,
                    session.created_at,
                    session.updated_at,
                    json.dumps(session.metadata) if session.metadata else None,
                ),
            )
            self._conn.execute("DELETE FROM messages WHERE session_id = ?", (session.id,))
            for index, message in enumerate(session.messages):
                self._conn.execute(
                    "INSERT INTO messages(session_id, seq, role, content, body) VALUES (?, ?, ?, ?, ?)",
                    (session.id, index, message.role, _serialize_message(message), _message_text(message)),
                )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    async def append_messages(self, session_id: str, messages: list[Message]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        existing = await self.get(session_id)
        if existing is None:
            await self.save(
                SessionRecord(
                    id=session_id,
                    messages=list(messages),
                    created_at=now,
                    updated_at=now,
                )
            )
            return

        start_seq = len(existing.messages)
        self._conn.execute("BEGIN")
        try:
            for offset, message in enumerate(messages):
                self._conn.execute(
                    "INSERT INTO messages(session_id, seq, role, content, body) VALUES (?, ?, ?, ?, ?)",
                    (
                        session_id,
                        start_seq + offset,
                        message.role,
                        _serialize_message(message),
                        _message_text(message),
                    ),
                )
            self._conn.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    async def search(self, query: str, limit: int = 20) -> list[SessionSearchHit]:
        rows = self._conn.execute(
            """
            SELECT m.session_id, m.seq, snippet(messages_fts, 1, '[[', ']]', '...', 12) AS snippet
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.rowid
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        ).fetchall()
        return [
            SessionSearchHit(session_id=row["session_id"], message_index=row["seq"], snippet=row["snippet"])
            for row in rows
        ]

    def close(self) -> None:
        self._conn.close()
