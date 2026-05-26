from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, key)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  scope UNINDEXED,
  key,
  value,
  content='memory_entries',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_fts(rowid, scope, key, value) VALUES (new.id, new.scope, new.key, new.value);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, scope, key, value) VALUES ('delete', old.id, old.scope, old.key, old.value);
END;

CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, scope, key, value) VALUES ('delete', old.id, old.scope, old.key, old.value);
  INSERT INTO memory_fts(rowid, scope, key, value) VALUES (new.id, new.scope, new.key, new.value);
END;
"""


class SqliteMemoryProvider:
    def __init__(self, database_path: str) -> None:
        path = Path(database_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.executescript(SCHEMA)

    async def get(self, key: str, scope: str = "working") -> str | None:
        row = self._conn.execute(
            "SELECT value FROM memory_entries WHERE scope = ? AND key = ?",
            (scope, key),
        ).fetchone()
        return None if row is None else row["value"]

    async def set(self, key: str, value: str, scope: str = "working") -> None:
        updated_at = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            """
            INSERT INTO memory_entries(scope, key, value, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (scope, key, value, updated_at),
        )
        self._conn.commit()

    async def search(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        rows = self._conn.execute(
            """
            SELECT memory_entries.scope, memory_entries.key, memory_entries.value, memory_entries.updated_at
            FROM memory_fts
            JOIN memory_entries ON memory_entries.id = memory_fts.rowid
            WHERE memory_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        ).fetchall()
        return [
            {
                "key": row["key"],
                "value": row["value"],
                "scope": row["scope"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    async def clear(self, scope: str | None = None) -> None:
        if scope is None:
            self._conn.execute("DELETE FROM memory_entries")
        else:
            self._conn.execute("DELETE FROM memory_entries WHERE scope = ?", (scope,))
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
