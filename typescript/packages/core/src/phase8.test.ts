import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import {
  createAgentRuntime,
  InMemoryMemoryProvider,
  MemoryAugmentedContextEngine,
  WebhookSurface,
  WorkspaceContextEngine,
} from '../src/index.js';
import { createCodingRuntime } from '../src/coding-runtime.js';
import { MockProvider } from '@agent-framework/providers';

describe('MemoryAugmentedContextEngine', () => {
  it('injects matching memory entries into the system prompt', async () => {
    const memory = new InMemoryMemoryProvider();
    await memory.set('stack', 'TypeScript and Python agent framework', 'persistent');

    const engine = new MemoryAugmentedContextEngine({
      inner: new WorkspaceContextEngine({ workspaceRoot: tmpdir() }),
      memory,
    });

    const result = await engine.build({
      sessionId: 'memory-session',
      history: [{ role: 'user', content: 'What stack do we use?' }],
    });

    expect(result.systemPrompt).toContain('## Memory');
    expect(result.systemPrompt).toContain('TypeScript and Python agent framework');
  });

  it('wires memory augmentation through createAgentRuntime', async () => {
    const memory = new InMemoryMemoryProvider();
    await memory.set('note', 'memory wired into runtime', 'persistent');

    const runtime = createAgentRuntime(new MockProvider({ responses: [{ text: 'ok' }] }), { memory });
    const result = await runtime.contextEngine.build({
      sessionId: 's1',
      history: [{ role: 'user', content: 'memory wired' }],
    });

    expect(result.systemPrompt).toContain('memory wired into runtime');
  });
});

describe('WebhookSurface', () => {
  it('runs agent requests over HTTP', async () => {
    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'webhook ok' }] }));
    const surface = new WebhookSurface({ runtime, host: '127.0.0.1', port: 0, path: '/webhook' });
    const port = await surface.start();

    const response = await postJson(`http://127.0.0.1:${port}/webhook`, {
      sessionId: 'webhook-session',
      message: 'hello webhook',
    });

    expect(response.ok).toBe(true);
    expect(Array.isArray(response.events)).toBe(true);
    expect(response.events.some((event) => event.type === 'assistant')).toBe(true);
  });
});

async function postJson(url: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  events: Array<{ type?: string }>;
}> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok: boolean; events: Array<{ type?: string }> });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
