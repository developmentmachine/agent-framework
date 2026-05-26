import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCodingRuntime } from '@agent-framework/core';
import { MockProvider } from '@agent-framework/providers';
import { bootstrapPlugins } from '@agent-framework/plugin-sdk';
import { createGatewayServer } from './index.js';

async function openGateway() {
  const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'gateway ok' }] }));
  const gateway = createGatewayServer({ runtime, port: 0 });
  const port = await gateway.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'req', id: '1', method: 'connect', params: {} }));
  await once(socket, 'message');
  return { runtime, socket };
}

describe('AgentGateway', () => {
  it('handles connect and health', async () => {
    const { socket } = await openGateway();
    socket.send(JSON.stringify({ type: 'req', id: '2', method: 'health', params: {} }));
    const healthRaw = await once(socket, 'message');
    expect(JSON.parse(String(healthRaw[0]))).toMatchObject({
      ok: true,
      payload: { status: 'ok' },
    });
    socket.close();
  });

  it('lists tools and sessions', async () => {
    const { runtime, socket } = await openGateway();
    await runtime.sessions.appendMessages('gw-session', [{ role: 'user', content: 'hello' }]);

    socket.send(JSON.stringify({ type: 'req', id: '3', method: 'tools.list', params: {} }));
    const toolsRaw = await once(socket, 'message');
    expect(JSON.parse(String(toolsRaw[0])).payload.tools).toBeDefined();

    socket.send(JSON.stringify({ type: 'req', id: '4', method: 'sessions.list', params: {} }));
    const sessionsRaw = await once(socket, 'message');
    expect(JSON.parse(String(sessionsRaw[0])).payload.sessions.length).toBeGreaterThan(0);
    socket.close();
  });
});

describe('bootstrapPlugins', () => {
  it('loads tools from plugin search paths', async () => {
    const runtime = createCodingRuntime(new MockProvider({ responses: [{ text: 'ok' }] }));
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../plugin-sdk/fixtures/sample-plugin',
    );
    await bootstrapPlugins(runtime, { searchPaths: [fixture] });
    expect(runtime.tools.get('plugin_ping')).toBeDefined();
  });
});
