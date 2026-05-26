import type { MemoryEntry, MemoryProvider } from './types/contracts.js';

export class InMemoryMemoryProvider implements MemoryProvider {
  private store = new Map<string, MemoryEntry>();

  private key(scope: 'working' | 'persistent', key: string): string {
    return `${scope}:${key}`;
  }

  async get(key: string, scope: 'working' | 'persistent' = 'working'): Promise<string | null> {
    return this.store.get(this.key(scope, key))?.value ?? null;
  }

  async set(key: string, value: string, scope: 'working' | 'persistent' = 'working'): Promise<void> {
    this.store.set(this.key(scope, key), {
      key,
      value,
      scope,
      updatedAt: new Date().toISOString(),
    });
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    return [...this.store.values()]
      .filter((entry) => matchesMemoryQuery(entry, query))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, limit);
  }

  async clear(scope?: 'working' | 'persistent'): Promise<void> {
    if (!scope) {
      this.store.clear();
      return;
    }
    for (const [composite, entry] of this.store.entries()) {
      if (entry.scope === scope) {
        this.store.delete(composite);
      }
    }
  }
}


function matchesMemoryQuery(entry: MemoryEntry, query: string): boolean {
  const needle = query.toLowerCase();
  const key = entry.key.toLowerCase();
  const value = entry.value.toLowerCase();
  if (key.includes(needle) || value.includes(needle) || (key.length > 0 && needle.includes(key))) {
    return true;
  }
  const tokens = needle.split(/\s+/).filter((token) => token.length > 2);
  return tokens.some((token) => key.includes(token) || value.includes(token));
}
