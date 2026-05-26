import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentRuntime, StreamEvent } from '@agent-framework/core';
import { serializeStreamEvent } from '@agent-framework/core';

export type GatewayRequestFrame = {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type GatewayResponseFrame = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export type GatewayEventFrame = {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
};

export type GatewayFrame = GatewayRequestFrame | GatewayResponseFrame | GatewayEventFrame;

export interface GatewayOptions {
  host?: string;
  port?: number;
  runtime: AgentRuntime;
}

export class AgentGateway {
  private seq = 0;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(private readonly options: GatewayOptions) {}

  start(): Promise<number> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('agent-framework gateway');
    });

    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => this.handleConnection(socket));

    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 18789;

    return new Promise((resolve) => {
      server.listen(port, host, () => {
        const address = server.address();
        const resolvedPort = typeof address === 'object' && address ? address.port : port;
        resolve(resolvedPort);
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.once('message', async (raw) => {
      const frame = JSON.parse(String(raw)) as GatewayFrame;
      if (frame.type !== 'req' || frame.method !== 'connect') {
        socket.close(1008, 'First frame must be connect');
        return;
      }
      this.send(socket, {
        type: 'res',
        id: frame.id,
        ok: true,
        payload: {
          hello: 'ok',
          features: {
            methods: ['agent', 'agent.cancel', 'health', 'tools.list', 'sessions.list', 'memory.search'],
            events: ['agent'],
          },
        },
      });

      socket.on('message', (message) => {
        void this.handleFrame(socket, JSON.parse(String(message)) as GatewayFrame);
      });
    });
  }

  private async handleFrame(socket: WebSocket, frame: GatewayFrame): Promise<void> {
    if (frame.type !== 'req') {
      return;
    }

    try {
      if (frame.method === 'health') {
        this.send(socket, { type: 'res', id: frame.id, ok: true, payload: { status: 'ok' } });
        return;
      }

      if (frame.method === 'tools.list') {
        this.send(socket, {
          type: 'res',
          id: frame.id,
          ok: true,
          payload: { tools: this.options.runtime.tools.list() },
        });
        return;
      }

      if (frame.method === 'sessions.list') {
        const sessions = await this.options.runtime.sessions.list();
        this.send(socket, {
          type: 'res',
          id: frame.id,
          ok: true,
          payload: {
            sessions: sessions.map((session) => ({
              id: session.id,
              messageCount: session.messages.length,
              updatedAt: session.updatedAt,
            })),
          },
        });
        return;
      }

      if (frame.method === 'memory.search') {
        const query = String(frame.params.query ?? '');
        const limit = Number(frame.params.limit ?? 10);
        const entries = await this.options.runtime.memory.search(query, limit);
        this.send(socket, { type: 'res', id: frame.id, ok: true, payload: { entries } });
        return;
      }

      if (frame.method === 'agent.cancel') {
        const runId = String(frame.params.runId ?? '');
        const controller = this.activeRuns.get(runId);
        if (controller) {
          controller.abort();
          this.activeRuns.delete(runId);
        }
        this.send(socket, { type: 'res', id: frame.id, ok: true, payload: { cancelled: Boolean(controller) } });
        return;
      }

      if (frame.method === 'agent') {
        const sessionId = String(frame.params.sessionId ?? 'default');
        const message = String(frame.params.message ?? '');
        const run = this.options.runtime.runs.create(sessionId);
        const abortController = new AbortController();
        this.activeRuns.set(run.runId, abortController);

        const generator = this.options.runtime.router.route({
          sessionId,
          input: { role: 'user', content: message },
          abortSignal: abortController.signal,
        });

        let result = await generator.next();
        while (!result.done) {
          this.publishAgentEvent(socket, result.value);
          result = await generator.next();
        }

        this.activeRuns.delete(run.runId);
        this.send(socket, {
          type: 'res',
          id: frame.id,
          ok: true,
          payload: { status: 'completed', runId: run.runId, reason: result.value },
        });
        return;
      }

      this.send(socket, { type: 'res', id: frame.id, ok: false, error: `Unknown method: ${frame.method}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send(socket, { type: 'res', id: frame.id, ok: false, error: message });
    }
  }

  private publishAgentEvent(socket: WebSocket, event: StreamEvent): void {
    this.send(socket, {
      type: 'event',
      event: 'agent',
      payload: serializeStreamEvent(event),
      seq: ++this.seq,
    });
  }

  private send(socket: WebSocket, frame: GatewayFrame): void {
    socket.send(JSON.stringify(frame));
  }
}

export function createGatewayServer(options: GatewayOptions) {
  return new AgentGateway(options);
}
