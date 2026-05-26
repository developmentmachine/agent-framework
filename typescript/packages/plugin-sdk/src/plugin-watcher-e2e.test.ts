import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodingRuntime } from '@agent-framework/core';
import { MockProvider } from '@agent-framework/providers';
import { PluginWatcher } from './plugin-watcher.js';

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('PluginWatcher E2E', () => {
  it(
    'reloads plugins when files change on disk',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'plugin-watch-e2e-'));
      writeFileSync(
        join(dir, 'agent.plugin.json'),
        JSON.stringify({ id: 'sample', version: '0.1.0', name: 'Sample', capabilities: ['tools'] }),
      );
      writeFileSync(
        join(dir, 'index.mjs'),
        `export default {
          register(ctx) {
            ctx.registerTool({
              definition: { name: 'watched_tool', description: 'watch me', parameters: { type: 'object', properties: {} } },
              execute: async () => 'ok',
            });
          },
        };`,
      );

      const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'ok' }] }));
      const watcher = new PluginWatcher(runtime, { searchPaths: [dir], debounceMs: 100 });
      const stop = watcher.start();

      await waitFor(() => runtime.tools.get('watched_tool') !== undefined, 2_000);
      expect(runtime.tools.get('watched_tool')).toBeDefined();

      writeFileSync(
        join(dir, 'index.mjs'),
        `export default {
          register(ctx) {
            ctx.registerTool({
              definition: { name: 'watched_tool_v2', description: 'watch me v2', parameters: { type: 'object', properties: {} } },
              execute: async () => 'ok',
            });
          },
        };`,
      );

      await waitFor(() => runtime.tools.get('watched_tool_v2') !== undefined, 3_000);
      expect(runtime.tools.get('watched_tool_v2')).toBeDefined();

      stop();
      rmSync(dir, { recursive: true, force: true });
    },
    10_000,
  );
});
