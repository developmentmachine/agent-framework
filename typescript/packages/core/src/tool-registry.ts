import { z } from 'zod';
import type { Tool, ToolCallRequest, ToolExecutionContext, ToolRegistry } from './types/contracts.js';
import { AgentError } from './types/contracts.js';

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(toolset?: string[]): import('./types/domain.js').ToolDefinition[] {
    const all = [...this.tools.values()].map((tool) => tool.definition);
    if (!toolset || toolset.length === 0) {
      return all.sort((a, b) => a.name.localeCompare(b.name));
    }
    const allowed = new Set(toolset);
    return all.filter((tool) => allowed.has(tool.name)).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(
    ctx: ToolExecutionContext,
    call: ToolCallRequest,
  ): Promise<{ output: unknown; error?: string }> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new AgentError(`Tool not found: ${call.name}`, 'TOOL_NOT_FOUND');
    }

    try {
      const output = await withTimeout(
        tool.execute(ctx, call.arguments),
        ctx.abortSignal,
      );
      return { output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: null, error: message };
    }
  }
}

export function createZodTool<T extends z.ZodTypeAny>(
  definition: import('./types/domain.js').ToolDefinition,
  schema: T,
  execute: (ctx: ToolExecutionContext, args: z.infer<T>) => Promise<unknown>,
): Tool {
  return {
    definition,
    async execute(ctx, args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        throw new AgentError(parsed.error.message, 'VALIDATION_ERROR');
      }
      return execute(ctx, parsed.data);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, abortSignal?: AbortSignal): Promise<T> {
  if (!abortSignal) {
    return promise;
  }
  if (abortSignal.aborted) {
    throw new AgentError('Operation cancelled', 'CANCELLED');
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AgentError('Operation cancelled', 'CANCELLED'));
    abortSignal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        abortSignal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        abortSignal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
