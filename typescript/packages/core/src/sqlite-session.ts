import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Message } from './types/domain.js';
import type { SessionRecord, SessionSearchHit, SessionStore } from './types/contracts.js';

function serializeMessage(message: Message): string {
  return JSON.stringify(message);
}

function deserializeMessage(raw: string): Message {
  return JSON.parse(raw) as Message;
}

function messageText(message: Message): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

const SCHEMA = `
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
`;

export class SqliteSessionStore implements SessionStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const session = this.db
      .prepare('SELECT id, created_at, updated_at, metadata FROM sessions WHERE id = ?')
      .get(sessionId) as { id: string; created_at: string; updated_at: string; metadata: string | null } | undefined;

    if (!session) {
      return null;
    }

    const rows = this.db
      .prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as Array<{ content: string }>;

    return {
      id: session.id,
      messages: rows.map((row) => deserializeMessage(row.content)),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      metadata: session.metadata ? (JSON.parse(session.metadata) as Record<string, unknown>) : undefined,
    };
  }

  async save(session: SessionRecord): Promise<void> {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO sessions(id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, metadata = excluded.metadata',
        )
        .run(
          session.id,
          session.createdAt,
          session.updatedAt,
          session.metadata ? JSON.stringify(session.metadata) : null,
        );

      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.id);
      const insert = this.db.prepare(
        'INSERT INTO messages(session_id, seq, role, content, body) VALUES (?, ?, ?, ?, ?)',
      );
      session.messages.forEach((message, index) => {
        insert.run(session.id, index, message.role, serializeMessage(message), messageText(message));
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async appendMessages(sessionId: string, messages: Message[]): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get(sessionId);
    if (!existing) {
      await this.save({
        id: sessionId,
        messages: [...messages],
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const startSeq = existing.messages.length;
    const insert = this.db.prepare(
      'INSERT INTO messages(session_id, seq, role, content, body) VALUES (?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      messages.forEach((message, offset) => {
        insert.run(sessionId, startSeq + offset, message.role, serializeMessage(message), messageText(message));
      });
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async list(): Promise<SessionRecord[]> {
    const rows = this.db
      .prepare('SELECT id FROM sessions ORDER BY id ASC')
      .all() as Array<{ id: string }>;
    const sessions: SessionRecord[] = [];
    for (const row of rows) {
      const session = await this.get(row.id);
      if (session) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  async search(query: string, limit = 20): Promise<SessionSearchHit[]> {
    const rows = this.db
      .prepare(
        `SELECT m.session_id, m.seq, snippet(messages_fts, 1, '[[', ']]', '...', 12) AS snippet
         FROM messages_fts
         JOIN messages m ON m.id = messages_fts.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ session_id: string; seq: number; snippet: string }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      messageIndex: row.seq,
      snippet: row.snippet,
    }));
  }

  close(): void {
    this.db.close();
  }
}
