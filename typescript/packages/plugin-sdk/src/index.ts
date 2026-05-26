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

async function importPluginModule(searchPath: string, bustCache = false): Promise<Plugin | undefined> {
  for (const fileName of ['index.js', 'index.mjs']) {
    try {
      const modulePath = join(searchPath, fileName);
      const href = bustCache
        ? `data:text/javascript;base64,${Buffer.from(await readFile(modulePath, 'utf8')).toString('base64')}`
        : pathToFileURL(modulePath).href;
      const imported = (await import(href)) as {
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

  async loadAll(options: { bustCache?: boolean } = {}): Promise<LoadedPlugin[]> {
    const plugins: LoadedPlugin[] = [];
    for (const searchPath of this.searchPaths) {
      const manifestPath = join(searchPath, 'agent.plugin.json');
      try {
        const raw = await readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as PluginManifest;
        const plugin = await importPluginModule(searchPath, options.bustCache);
        if (plugin) {
          plugins.push({ manifest, plugin });
        }
      } catch {
        // Optional plugin path.
      }
    }
    return plugins.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  }

  async apply(registry: ToolRegistry, hooks: DefaultHookRunner, providers: ModelProvider[] = [], options: { bustCache?: boolean } = {}): Promise<void> {
    const plugins = await this.loadAll(options);
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
export { PluginWatcher, type PluginWatcherOptions } from './plugin-watcher.js';

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
