import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MemoryEntry, MemoryProvider } from './types/contracts.js';

const SCHEMA = `
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
`;

export class SqliteMemoryProvider implements MemoryProvider {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  async get(key: string, scope: 'working' | 'persistent' = 'working'): Promise<string | null> {
    const row = this.db
      .prepare('SELECT value FROM memory_entries WHERE scope = ? AND key = ?')
      .get(scope, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async set(key: string, value: string, scope: 'working' | 'persistent' = 'working'): Promise<void> {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO memory_entries(scope, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(scope, key, value, updatedAt);
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT memory_entries.scope, memory_entries.key, memory_entries.value, memory_entries.updated_at
         FROM memory_fts
         JOIN memory_entries ON memory_entries.id = memory_fts.rowid
         WHERE memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ scope: string; key: string; value: string; updated_at: string }>;

    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      scope: row.scope as 'working' | 'persistent',
      updatedAt: row.updated_at,
    }));
  }

  async clear(scope?: 'working' | 'persistent'): Promise<void> {
    if (!scope) {
      this.db.exec('DELETE FROM memory_entries');
      return;
    }
    this.db.prepare('DELETE FROM memory_entries WHERE scope = ?').run(scope);
  }

  close(): void {
    this.db.close();
  }
}
