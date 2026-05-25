import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AgentRuntime, StreamEvent } from '@agent-framework/core';

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
  private connected = false;

  constructor(private readonly options: GatewayOptions) {}

  start(): Promise<void> {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('agent-framework gateway');
    });

    const wss = new WebSocketServer({ server });
    wss.on('connection', (socket) => this.handleConnection(socket));

    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 18789;

    return new Promise((resolve) => {
      server.listen(port, host, () => resolve());
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.once('message', async (raw) => {
      const frame = JSON.parse(String(raw)) as GatewayFrame;
      if (frame.type !== 'req' || frame.method !== 'connect') {
        socket.close(1008, 'First frame must be connect');
        return;
      }
      this.connected = true;
      this.send(socket, {
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { hello: 'ok', features: { methods: ['agent', 'health'], events: ['agent'] } },
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

    if (frame.method === 'health') {
      this.send(socket, { type: 'res', id: frame.id, ok: true, payload: { status: 'ok' } });
      return;
    }

    if (frame.method === 'agent') {
      const sessionId = String(frame.params.sessionId ?? 'default');
      const message = String(frame.params.message ?? '');
      const generator = this.options.runtime.router.route({
        sessionId,
        input: { role: 'user', content: message },
      });

      let result = await generator.next();
      while (!result.done) {
        this.publishAgentEvent(socket, result.value);
        result = await generator.next();
      }

      this.send(socket, {
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { status: 'completed', reason: result.value },
      });
      return;
    }

    this.send(socket, { type: 'res', id: frame.id, ok: false, error: `Unknown method: ${frame.method}` });
  }

  private publishAgentEvent(socket: WebSocket, event: StreamEvent): void {
    this.send(socket, {
      type: 'event',
      event: 'agent',
      payload: event,
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

export class SqliteSessionStore {
  constructor(private readonly dbPath: string) {
    void this.dbPath;
  }

  async init(): Promise<void> {
    // Phase 2 skeleton: wire better-sqlite3 or node:sqlite when available.
  }
}
