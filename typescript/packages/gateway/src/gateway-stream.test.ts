import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createCodingRuntime } from '@agent-framework/core';
import { MockProvider } from '@agent-framework/providers';
import { createGatewayServer } from './index.js';

function createMessageStream(socket: WebSocket) {
  const pending: unknown[] = [];
  const waiters: Array<(frame: unknown) => void> = [];

  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw));
    const waiter = waiters.shift();
    if (waiter) {
      waiter(frame);
    } else {
      pending.push(frame);
    }
  });

  return (): Promise<unknown> =>
    new Promise((resolve) => {
      const next = pending.shift();
      if (next) {
        resolve(next);
        return;
      }
      waiters.push(resolve);
    });
}

describe('AgentGateway agent streaming', () => {
  it(
    'streams agent events before the final response',
    async () => {
      const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'stream ok' }] }));
      const gateway = createGatewayServer({ runtime, port: 0 });
      const port = await gateway.start();

      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      await once(socket, 'open');
      const nextMessage = createMessageStream(socket);

      socket.send(JSON.stringify({ type: 'req', id: '1', method: 'connect', params: {} }));
      await nextMessage();

      socket.send(
        JSON.stringify({
          type: 'req',
          id: 'agent-1',
          method: 'agent',
          params: { sessionId: 'stream', message: 'hello stream' },
        }),
      );

      const events: unknown[] = [];
      let response: unknown;
      const deadline = Date.now() + 10_000;
      while (!response && Date.now() < deadline) {
        const frame = (await nextMessage()) as {
          type: string;
          id?: string;
          payload?: unknown;
          ok?: boolean;
        };
        if (frame.type === 'event') {
          events.push(frame.payload);
        }
        if (frame.type === 'res' && frame.id === 'agent-1') {
          response = frame;
        }
      }

      expect(events.length).toBeGreaterThan(0);
      expect(response).toMatchObject({ ok: true });
      socket.close();
    },
    15_000,
  );
});
