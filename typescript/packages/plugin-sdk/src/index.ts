import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  HookHandler,
  ModelProvider,
  Plugin,
  PluginContext,
  PluginManifest,
  Tool,
  ToolRegistry,
} from '@agent-framework/core';
import { DefaultHookRunner } from '@agent-framework/core';

export interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: Plugin;
}

export function definePlugin(manifest: PluginManifest, register: Plugin['register']): Plugin {
  return { manifest, register };
}

export class PluginLoader {
  constructor(private readonly searchPaths: string[]) {}

  async loadAll(): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    for (const searchPath of this.searchPaths) {
      const manifestPath = join(searchPath, 'agent.plugin.json');
      try {
        const raw = await readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as PluginManifest;
        const modulePath = join(searchPath, 'index.js');
        const imported = (await import(modulePath)) as { default?: Plugin; plugin?: Plugin };
        const plugin = imported.default ?? imported.plugin;
        if (plugin) {
          plugins.push({ manifest, plugin });
        }
      } catch {
        // Optional plugin path.
      }
    }
    return plugins.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }

  async apply(registry: ToolRegistry, hooks: DefaultHookRunner, providers: ModelProvider[] = []): Promise<void> {
    const plugins = await this.loadAll();
    const context: PluginContext = {
      registerTool(tool: Tool) {
        registry.register(tool);
      },
      registerHook(handler: HookHandler) {
        hooks.register(handler);
      },
      registerProvider(provider: ModelProvider) {
        providers.push(provider);
      },
    };

    for (const loaded of plugins) {
      await loaded.plugin.register(context);
    }
  }
}

export interface MCPClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  constructor(private readonly options: MCPClientOptions) {}

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
    // Phase 2 skeleton: real stdio transport can be wired here.
    void this.options;
    return [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    void name;
    void args;
    throw new Error('MCP transport not configured');
  }
}

export class SubAgentToolFactory {
  constructor(private readonly runPrompt: (prompt: string, sessionId: string) => Promise<string>) {}

  createDelegateTool(): Tool {
    return {
      definition: {
        name: 'delegate',
        description: 'Spawn an isolated sub-agent with its own context',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
        concurrency: 'serial',
      },
      execute: async (ctx, args) => {
        const prompt = String(args.prompt ?? '');
        return this.runPrompt(prompt, `${ctx.sessionId}:sub:${ctx.runId}`);
      },
    };
  }
}
