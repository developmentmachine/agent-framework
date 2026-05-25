import { randomUUID } from 'node:crypto';
import type { Message, ModelChunk, ToolDefinition } from '@agent-framework/core';
import type { ModelProvider, StreamRequest } from '@agent-framework/core';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic';

  constructor(private readonly options: AnthropicProviderOptions) {}

  async *stream(request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const system = request.messages.find((message) => message.role === 'system');
    const body = {
      model: this.options.model,
      max_tokens: 8192,
      system: typeof system?.content === 'string' ? system.content : undefined,
      messages: toAnthropicMessages(request.messages.filter((message) => message.role !== 'system')),
      tools: request.tools.map(toAnthropicTool),
      stream: true,
    };

    const response = await fetch(`${this.options.baseUrl ?? 'https://api.anthropic.com/v1'}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    }

    if (!response.body) {
      throw new Error('Anthropic API returned empty body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentTool: { id: string; name: string; arguments: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (!payload) {
          continue;
        }
        const event = JSON.parse(payload) as AnthropicStreamEvent;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield { type: 'text_delta', textDelta: event.delta.text };
        }
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          currentTool = {
            id: event.content_block.id,
            name: event.content_block.name,
            arguments: '',
          };
        }
        if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && currentTool) {
          currentTool.arguments += event.delta.partial_json ?? '';
        }
        if (event.type === 'content_block_stop' && currentTool) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: currentTool.id,
              name: currentTool.name,
              arguments: JSON.parse(currentTool.arguments || '{}') as Record<string, unknown>,
            },
          };
          currentTool = null;
        }
        if (event.type === 'message_delta' && event.usage) {
          yield {
            type: 'usage',
            usage: {
              input: event.usage.input_tokens ?? 0,
              output: event.usage.output_tokens ?? 0,
              total: (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
            },
          };
        }
      }
    }

    yield { type: 'done' };
  }
}

interface AnthropicStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
  content_block?: {
    type?: string;
    id: string;
    name: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

function toAnthropicMessages(messages: Message[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role === 'tool' ? 'user' : message.role, content: message.content };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content.map((part) => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          }
          if (part.type === 'tool_call') {
            return {
              type: 'tool_use',
              id: part.id,
              name: part.name,
              input: part.arguments,
            };
          }
          return { type: 'text', text: '' };
        }),
      };
    }
    if (message.role === 'tool') {
      const part = message.content.find((item) => item.type === 'tool_result');
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: part?.type === 'tool_result' ? part.toolCallId : randomUUID(),
            content: part?.type === 'tool_result' ? part.content : '',
          },
        ],
      };
    }
    return { role: message.role, content: JSON.stringify(message.content) };
  });
}
