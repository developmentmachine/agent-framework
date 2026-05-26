import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function importPluginModule(searchPath: string): Promise<Plugin | undefined> {
  for (const fileName of ['index.js', 'index.mjs']) {
    try {
      const modulePath = join(searchPath, fileName);
      const imported = (await import(pathToFileURL(modulePath).href)) as {
        default?: Plugin;
        plugin?: Plugin;
      };
      return imported.default ?? imported.plugin;
    } catch {
      // try next module filename
    }
  }
  return undefined;
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
        const plugin = await importPluginModule(searchPath);
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

export { MCPClient, registerMcpTools, type MCPClientOptions, type MCPToolDescriptor } from './mcp-stdio.js';
export { bootstrapPlugins, type BootstrapPluginsOptions } from './bootstrap.js';

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
