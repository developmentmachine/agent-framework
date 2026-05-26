import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DefaultToolRegistry,
  createAgentRuntime,
  createTelemetryPipeline,
  type SandboxBackend,
  type ToolExecutionContext,
} from '@agent-framework/core';
import { createBuiltinTools } from '@agent-framework/tools-builtin';
import { MCPClient, registerMcpTools } from '@agent-framework/plugin-sdk';

class RecordingSandbox implements SandboxBackend {
  readonly commands: string[] = [];

  async execute(
    command: string,
    _options: { cwd: string; timeoutMs: number; abortSignal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.commands.push(command);
    return { stdout: `ran:${command}`, stderr: '', exitCode: 0 };
  }
}

describe('shell tool uses SandboxBackend', () => {
  it('routes shell execution through the sandbox backend', async () => {
    const sandbox = new RecordingSandbox();
    const registry = new DefaultToolRegistry();
    for (const tool of createBuiltinTools({ sandbox })) {
      registry.register(tool);
    }

    const ctx: ToolExecutionContext = {
      sessionId: 's1',
      runId: 'r1',
      workspaceRoot: process.cwd(),
    };

    const result = await registry.execute(ctx, {
      id: 'call-1',
      name: 'shell',
      arguments: { command: 'echo hello' },
    });

    expect(sandbox.commands).toEqual(['echo hello']);
    expect(result.output).toBe('ran:echo hello');
  });
});

describe('MCP stdio client', () => {
  it('lists and calls tools from a mock MCP server', async () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../plugin-sdk/fixtures/mock-mcp-server.mjs');
    const client = new MCPClient({ command: 'node', args: [fixture] });
    const registry = new DefaultToolRegistry();

    await registerMcpTools(client, registry);
    expect(registry.list().some((tool) => tool.name === 'echo')).toBe(true);

    const ctx: ToolExecutionContext = {
      sessionId: 's1',
      runId: 'r1',
      workspaceRoot: process.cwd(),
    };

    const result = await registry.execute(ctx, {
      id: 'call-2',
      name: 'echo',
      arguments: { text: 'mcp-ok' },
    });

    expect(result.output).toBe('mcp-ok');
    await client.close();
  });
});

describe('telemetry pipeline', () => {
  it('collects finished spans during agent runs', async () => {
    const exported: string[] = [];
    const runtime = createAgentRuntime(
      {
        id: 'mock',
        async *stream() {
          yield { type: 'text_delta', textDelta: 'done' };
        },
      },
      {
        telemetry: {
          exporters: [
            {
              export(spans) {
                exported.push(...spans.map((span) => span.name));
              },
            },
          ],
        },
      },
    );

    for await (const _event of runtime.router.route({
      sessionId: 'telemetry',
      input: { role: 'user', content: 'hello' },
    })) {
      void _event;
    }

    await runtime.telemetry?.flush();
    expect(exported.some((name) => name.startsWith('run:'))).toBe(true);
  });
});
