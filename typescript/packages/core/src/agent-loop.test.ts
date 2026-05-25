import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createAgentRuntime,
  DefaultToolRegistry,
  createZodTool,
  type ModelProvider,
  type StreamEvent,
  type ModelChunk,
  type StreamRequest,
} from '../src/index.js';
import { z } from 'zod';

class MockProvider implements ModelProvider {
  readonly id = 'mock';
  private turn = 0;

  constructor(private readonly responses: Array<{ text?: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }>) {}

  async *stream(_request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const scripted = this.responses[this.turn];
    this.turn += 1;
    if (!scripted) {
      yield { type: 'text_delta', textDelta: 'Done.' };
      yield { type: 'done' };
      return;
    }
    if (scripted.text) {
      yield { type: 'text_delta', textDelta: scripted.text };
    }
    for (const call of scripted.toolCalls ?? []) {
      yield {
        type: 'tool_call',
        toolCall: { id: randomUUID(), name: call.name, arguments: call.arguments },
      };
    }
    yield { type: 'done' };
  }
}

describe('DefaultSessionLane', () => {
  it('serializes runs for the same session', async () => {
    const order: number[] = [];
    const runtime = createAgentRuntime(
      new MockProvider([
        { toolCalls: [{ name: 'echo', arguments: { value: 'a' } }] },
        { text: 'done' },
      ]),
      { tools: createEchoRegistry() },
    );

    const first = runtime.router.route({
      sessionId: 'lane-test',
      input: { role: 'user', content: 'first' },
    });
    const second = runtime.router.route({
      sessionId: 'lane-test',
      input: { role: 'user', content: 'second' },
    });

    const consume = async (label: number, generator: AsyncGenerator<StreamEvent, unknown>) => {
      order.push(label);
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }
      order.push(label + 100);
    };

    await Promise.all([consume(1, first), consume(2, second)]);
    expect(order).toEqual([1, 2, 101, 102]);
  });
});

describe('AgentLoop', () => {
  it('executes tool calls and completes', async () => {
    const runtime = createAgentRuntime(
      new MockProvider([
        { toolCalls: [{ name: 'echo', arguments: { value: 'hello' } }] },
        { text: 'finished' },
      ]),
      { tools: createEchoRegistry() },
    );

    const events: StreamEvent[] = [];
    const generator = runtime.router.route({
      sessionId: 'loop-test',
      input: { role: 'user', content: 'say hello' },
    });
    let result = await generator.next();
    while (!result.done) {
      events.push(result.value);
      result = await generator.next();
    }

    expect(events.some((event) => event.type === 'tool' && event.name === 'echo')).toBe(true);
    expect(result.value).toEqual({ kind: 'completed' });
  });
});

function createEchoRegistry() {
  const registry = new DefaultToolRegistry();
  registry.register(
    createZodTool(
      {
        name: 'echo',
        description: 'Echo a value',
        parameters: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
      },
      z.object({ value: z.string() }),
      async (_ctx, args) => args.value,
    ),
  );
  return registry;
}
