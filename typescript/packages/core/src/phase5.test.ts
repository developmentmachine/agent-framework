import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createAgentRuntime,
  DefaultToolRegistry,
  createZodTool,
  InProcessSubAgentRunner,
  LlmSummarizationCompactor,
  SqliteSessionStore,
  type Message,
  type ModelChunk,
  type ModelProvider,
  type StreamRequest,
} from '../src/index.js';
import { z } from 'zod';

describe('SqliteSessionStore', () => {
  it('persists messages and supports FTS search', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-sqlite-'));
    const dbPath = join(dir, 'sessions.db');
    const store = new SqliteSessionStore(dbPath);

    await store.appendMessages('alpha', [{ role: 'user', content: 'find the needle in haystack' }]);
    await store.appendMessages('beta', [{ role: 'user', content: 'nothing here' }]);

    const hits = await store.search('needle');
    expect(hits.some((hit) => hit.sessionId === 'alpha')).toBe(true);
    expect(hits.some((hit) => hit.sessionId === 'beta')).toBe(false);

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('LlmSummarizationCompactor', () => {
  it('replaces middle messages with an LLM summary', async () => {
    const compactor = new LlmSummarizationCompactor({
      summarize: async (messages: Message[]) => `summary:${messages.length}`,
      keepRecent: 2,
    });

    const messages: Message[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first' },
      ...Array.from({ length: 8 }, (_, index) => ({ role: 'user' as const, content: `msg-${index}` })),
      { role: 'assistant', content: 'tail' },
    ];

    const compacted = await compactor.compact(messages, 20);
    expect(compacted.some((message) => String(message.content).includes('summary:'))).toBe(true);
    expect(compacted.length).toBeLessThan(messages.length);
  });
});

describe('parallel tool execution', () => {
  it('executes parallel tools concurrently', async () => {
    const registry = createSlowRegistry();
    const runtime = createAgentRuntime(
      new ScriptProvider([
        {
          toolCalls: [
            { name: 'slow', arguments: { label: 'a' } },
            { name: 'slow', arguments: { label: 'b' } },
          ],
        },
        { text: 'done' },
      ]),
      { tools: registry },
    );

    const started = Date.now();
    for await (const _event of runtime.router.route({
      sessionId: 'parallel',
      input: { role: 'user', content: 'run parallel tools' },
    })) {
      void _event;
    }
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(180);
  });
});

describe('InProcessSubAgentRunner', () => {
  it('spawn and wait returns completed reason', async () => {
    const runtime = createAgentRuntime(new ScriptProvider([{ text: 'subagent done' }]));
    const runner = new InProcessSubAgentRunner(runtime);
    const handle = await runner.spawn({
      prompt: 'do work',
      sessionId: 'parent:sub',
      parentRunId: 'parent-run',
    });

    const reason = await runner.wait(handle, 5_000);
    expect(reason.kind).toBe('completed');
  });
});

class ScriptProvider implements ModelProvider {
  readonly id = 'script';
  private turn = 0;

  constructor(
    private readonly responses: Array<{
      text?: string;
      toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    }>,
  ) {}

  async *stream(_request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const scripted = this.responses[this.turn];
    this.turn += 1;
    if (!scripted) {
      yield { type: 'text_delta', textDelta: 'Done.' };
      yield { type: 'done' };
      return;
    }
    if (scripted.text) {
      yield { type: 'text_delta', textDelta: scripted.text };
    }
    for (const call of scripted.toolCalls ?? []) {
      yield {
        type: 'tool_call',
        toolCall: { id: randomUUID(), name: call.name, arguments: call.arguments },
      };
    }
    yield { type: 'done' };
  }
}

function createSlowRegistry() {
  const registry = new DefaultToolRegistry();
  registry.register(
    createZodTool(
      {
        name: 'slow',
        description: 'Slow parallel tool',
        parameters: {
          type: 'object',
          properties: { label: { type: 'string' } },
          required: ['label'],
        },
        concurrency: 'parallel',
      },
      z.object({ label: z.string() }),
      async (_ctx, args) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return args.label;
      },
    ),
  );
  return registry;
}
