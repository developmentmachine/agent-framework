import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodingRuntime, SqliteMemoryProvider } from '../src/index.js';
import { MockProvider } from '@agent-framework/providers';

describe('SqliteMemoryProvider', () => {
  it('persists and searches memory entries with FTS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-memory-'));
    const dbPath = join(dir, 'memory.db');
    const memory = new SqliteMemoryProvider(dbPath);

    await memory.set('project', 'agent framework', 'persistent');
    await memory.set('temp', 'ignore', 'working');

    expect(await memory.get('project', 'persistent')).toBe('agent framework');
    const hits = await memory.search('framework');
    expect(hits.some((entry) => entry.key === 'project')).toBe(true);

    memory.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createCodingRuntime sqlite memory', () => {
  it('wires sqlite memory when path is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coding-memory-'));
    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'ok' }] }), {
      sqliteMemoryPath: join(dir, 'memory.db'),
    });

    await runtime.memory.set('note', 'sqlite memory works', 'working');
    expect(await runtime.memory.get('note')).toBe('sqlite memory works');

    if ('close' in runtime.memory && typeof runtime.memory.close === 'function') {
      runtime.memory.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
