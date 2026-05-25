import { randomUUID } from 'node:crypto';
import type { ModelChunk } from '@agent-framework/core';
import type { ModelProvider, StreamRequest } from '@agent-framework/core';

export interface MockProviderOptions {
  responses?: Array<{ text?: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }> }>;
}

export class MockProvider implements ModelProvider {
  readonly id = 'mock';
  private turn = 0;

  constructor(private readonly options: MockProviderOptions = {}) {}

  async *stream(_request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const scripted = this.options.responses?.[this.turn];
    this.turn += 1;

    if (!scripted) {
      yield { type: 'text_delta', textDelta: 'Done.' };
      yield { type: 'usage', usage: { input: 1, output: 1, total: 2 } };
      yield { type: 'done' };
      return;
    }

    if (scripted.text) {
      yield { type: 'text_delta', textDelta: scripted.text };
    }

    for (const call of scripted.toolCalls ?? []) {
      yield {
        type: 'tool_call',
        toolCall: {
          id: randomUUID(),
          name: call.name,
          arguments: call.arguments,
        },
      };
    }

    yield { type: 'usage', usage: { input: 10, output: 5, total: 15 } };
    yield { type: 'done' };
  }
}
