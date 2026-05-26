import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Tool, ToolDefinitionSchema, ToolRegistry } from '@agent-framework/core';

export interface MCPClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface MCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private connected = false;

  constructor(private readonly options: MCPClientOptions) {}

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.process = spawn(this.options.command, this.options.args ?? [], {
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.flushBuffer();
    });

    this.process.on('close', () => {
      this.rejectAll(new Error('MCP process exited'));
      this.connected = false;
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-framework', version: '0.1.0' },
    });

    this.notify('notifications/initialized', {});
    this.connected = true;
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    await this.connect();
    const result = (await this.request('tools/list', {})) as { tools?: MCPToolDescriptor[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    const text = (result.content ?? [])
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n');

    if (result.isError) {
      throw new Error(text || `MCP tool ${name} failed`);
    }

    return text || result;
  }

  async close(): Promise<void> {
    this.process?.kill();
    this.process = null;
    this.connected = false;
    this.rejectAll(new Error('MCP client closed'));
  }

  private flushBuffer(): void {
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(JSON.parse(line) as JsonRpcResponse);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  private notify(method: string, params?: unknown): void {
    const payload = `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`;
    this.process?.stdin.write(payload);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.process?.stdin) {
      return Promise.reject(new Error('MCP process is not running'));
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process?.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function registerMcpTools(
  client: MCPClient,
  registry: ToolRegistry,
  options: { prefix?: string } = {},
): Promise<void> {
  const tools = await client.listTools();
  const prefix = options.prefix ? `${options.prefix}_` : '';

  for (const tool of tools) {
    const definition = {
      name: `${prefix}${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema as unknown as ToolDefinitionSchema,
    };

    registry.register({
      definition,
      execute: async (_ctx, args) => client.callTool(tool.name, args),
    } satisfies Tool);
  }
}
