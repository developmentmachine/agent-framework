import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCodingRuntime } from '@agent-framework/core';
import { MockProvider } from '@agent-framework/providers';
import { bootstrapPlugins } from './bootstrap.js';

describe('PluginWatcher', () => {
  it('loads plugins through bootstrap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-watch-'));
    writeFileSync(
      join(dir, 'agent.plugin.json'),
      JSON.stringify({ id: 'sample', version: '0.1.0', name: 'Sample', capabilities: ['tools'] }),
    );
    writeFileSync(
      join(dir, 'index.mjs'),
      `export default {
        manifest: { id: 'sample', version: '0.1.0', name: 'Sample', capabilities: ['tools'] },
        register(ctx) {
          ctx.registerTool({
            definition: { name: 'watched_tool', description: 'watch me', parameters: { type: 'object', properties: {} } },
            execute: async () => 'ok',
          });
        },
      };`,
    );

    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'ok' }] }));
    await bootstrapPlugins(runtime, { searchPaths: [dir] });
    expect(runtime.tools.get('watched_tool')).toBeDefined();

    writeFileSync(
      join(dir, 'index.mjs'),
      `export default {
        manifest: { id: 'sample', version: '0.1.0', name: 'Sample', capabilities: ['tools'] },
        register(ctx) {
          ctx.registerTool({
            definition: { name: 'watched_tool_v2', description: 'watch me v2', parameters: { type: 'object', properties: {} } },
            execute: async () => 'ok',
          });
        },
      };`,
    );

    runtime.tools.unregister('watched_tool');
    await bootstrapPlugins(runtime, { searchPaths: [dir], bustCache: true });
    expect(runtime.tools.get('watched_tool_v2')).toBeDefined();

    rmSync(dir, { recursive: true, force: true });
  });
});
