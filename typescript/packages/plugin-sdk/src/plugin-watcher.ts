import { watch, type FSWatcher } from 'node:fs';
import type { AgentRuntime } from '@agent-framework/core';
import { bootstrapPlugins, type BootstrapPluginsOptions } from './bootstrap.js';

export interface PluginWatcherOptions extends BootstrapPluginsOptions {
  debounceMs?: number;
  onReload?: (toolNames: string[]) => void;
}

export class PluginWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadedTools: string[] = [];

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly options: PluginWatcherOptions,
  ) {}

  start(): () => void {
    for (const searchPath of this.options.searchPaths) {
      try {
        const watcher = watch(searchPath, { recursive: true }, () => this.scheduleReload());
        this.watchers.push(watcher);
      } catch {
        // Optional plugin directory.
      }
    }

    void this.reload();

    return () => this.stop();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  private scheduleReload(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.reload();
    }, this.options.debounceMs ?? 300);
  }

  private async reload(): Promise<void> {
    for (const toolName of this.loadedTools) {
      this.runtime.tools.unregister(toolName);
    }

    const before = new Set(this.runtime.tools.list().map((tool) => tool.name));
    await bootstrapPlugins(this.runtime, { ...this.options, bustCache: true });
    const after = this.runtime.tools.list().map((tool) => tool.name);
    this.loadedTools = after.filter((name) => !before.has(name));
    this.options.onReload?.(this.loadedTools);
  }
}
