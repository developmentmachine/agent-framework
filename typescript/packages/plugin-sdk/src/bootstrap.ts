import type { AgentRuntime } from '@agent-framework/core';
import { DefaultHookRunner } from '@agent-framework/core';

export interface BootstrapPluginsOptions {
  searchPaths: string[];
}

export async function bootstrapPlugins(
  runtime: AgentRuntime,
  options: BootstrapPluginsOptions,
): Promise<void> {
  const { PluginLoader } = await import('./index.js');
  const loader = new PluginLoader(options.searchPaths);
  const hooks = runtime.hooks as DefaultHookRunner;
  const providers = [runtime.provider];
  await loader.apply(runtime.tools, hooks, providers);
}
