import { describe, expect, it } from 'vitest';
import {
  createCodingRuntime,
  createProviderSummarizer,
  CronAgentSurface,
  LlmSummarizationCompactor,
  type ModelProvider,
  type ModelChunk,
  type StreamRequest,
} from '../src/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MockProvider } from '@agent-framework/providers';

describe('createCodingRuntime', () => {
  it('uses sqlite sessions when path is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coding-runtime-'));
    const dbPath = join(dir, 'sessions.db');
    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'ok' }] }), {
      sqliteSessionPath: dbPath,
    });

    await runtime.sessions.appendMessages('sqlite-session', [{ role: 'user', content: 'persist me' }]);
    const session = await runtime.sessions.get('sqlite-session');
    expect(session?.messages[0]?.content).toBe('persist me');

    if ('close' in runtime.sessions && typeof runtime.sessions.close === 'function') {
      runtime.sessions.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createProviderSummarizer', () => {
  it('summarizes messages using the model provider', async () => {
    const provider: ModelProvider = {
      id: 'summary',
      async *stream(_request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
        yield { type: 'text_delta', textDelta: 'condensed summary' };
        yield { type: 'done' };
      },
    };

    const summarize = createProviderSummarizer(provider);
    const compactor = new LlmSummarizationCompactor({ summarize, keepRecent: 1 });
    const compacted = await compactor.compact(
      [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'third' },
      ],
      5,
    );

    expect(compacted.some((message) => String(message.content).includes('condensed summary'))).toBe(true);
  });
});

describe('CronAgentSurface', () => {
  it('runs scheduled prompts against the runtime', async () => {
    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'cron ok' }] }));
    const surface = new CronAgentSurface({ runtime });

    surface.register({
      id: 'tick',
      intervalMs: 50,
      prompt: 'cron hello',
      sessionId: 'cron-session',
      enabled: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    surface.stopAll();

    const session = await runtime.sessions.get('cron-session');
    expect((session?.messages.length ?? 0) > 0).toBe(true);
  });
});
