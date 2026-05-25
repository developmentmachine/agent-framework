import type { Message } from './types/domain.js';
import type { SessionRecord, SessionStore } from './types/contracts.js';

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  async get(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async save(session: SessionRecord): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async appendMessages(sessionId: string, messages: Message[]): Promise<void> {
    const existing = this.sessions.get(sessionId);
    const now = new Date().toISOString();
    if (!existing) {
      this.sessions.set(sessionId, {
        id: sessionId,
        messages: [...messages],
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    existing.messages.push(...messages);
    existing.updatedAt = now;
  }

  async list(): Promise<SessionRecord[]> {
    return [...this.sessions.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
