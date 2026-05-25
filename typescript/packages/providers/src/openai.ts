import { randomUUID } from 'node:crypto';
import type { Message, ModelChunk, ToolDefinition } from '@agent-framework/core';
import type { ModelProvider, StreamRequest } from '@agent-framework/core';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai';

  constructor(private readonly options: OpenAIProviderOptions) {}

  async *stream(request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const body = {
      model: this.options.model,
      messages: toOpenAIMessages(request.messages),
      tools: request.tools.map(toOpenAITool),
      stream: true,
      stream_options: { include_usage: true },
    };

    const response = await fetch(`${this.options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
    }

    if (!response.body) {
      throw new Error('OpenAI API returned empty body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

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
        if (payload === '[DONE]') {
          yield { type: 'done' };
          continue;
        }
        const parsed = JSON.parse(payload) as OpenAIStreamChunk;
        const choice = parsed.choices?.[0];
        if (choice?.delta?.content) {
          yield { type: 'text_delta', textDelta: choice.delta.content };
        }
        if (choice?.delta?.tool_calls) {
          for (const toolCall of choice.delta.tool_calls) {
            const index = toolCall.index ?? 0;
            const existing = toolCalls.get(index) ?? {
              id: toolCall.id ?? randomUUID(),
              name: toolCall.function?.name ?? '',
              arguments: '',
            };
            if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              existing.arguments += toolCall.function.arguments;
            }
            toolCalls.set(index, existing);
          }
        }
        if (parsed.usage) {
          yield {
            type: 'usage',
            usage: {
              input: parsed.usage.prompt_tokens ?? 0,
              output: parsed.usage.completion_tokens ?? 0,
              total: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    }

    for (const toolCall of [...toolCalls.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      yield {
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>,
        },
      };
    }
  }
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function toOpenAITool(tool: ToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOpenAIMessages(messages: Message[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }
    if (message.role === 'assistant') {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('');
      const toolCalls = message.content
        .filter((part) => part.type === 'tool_call')
        .map((part) =>
          part.type === 'tool_call'
            ? {
                id: part.id,
                type: 'function',
                function: { name: part.name, arguments: JSON.stringify(part.arguments) },
              }
            : null,
        )
        .filter(Boolean);
      return { role: 'assistant', content: text || null, tool_calls: toolCalls.length ? toolCalls : undefined };
    }
    if (message.role === 'tool') {
      const part = message.content.find((item) => item.type === 'tool_result');
      return {
        role: 'tool',
        tool_call_id: part?.type === 'tool_result' ? part.toolCallId : randomUUID(),
        content: part?.type === 'tool_result' ? part.content : '',
      };
    }
    return { role: message.role, content: JSON.stringify(message.content) };
  });
}
