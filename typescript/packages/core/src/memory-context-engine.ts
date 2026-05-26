import type {
  ContextBuildRequest,
  ContextBuildResult,
  ContextEngine,
  MemoryProvider,
} from './types/contracts.js';
import type { Message } from './types/domain.js';

export interface MemoryAugmentedContextEngineOptions {
  inner: ContextEngine;
  memory: MemoryProvider;
  limit?: number;
}

export class MemoryAugmentedContextEngine implements ContextEngine {
  private readonly limit: number;

  constructor(private readonly options: MemoryAugmentedContextEngineOptions) {
    this.limit = options.limit ?? 5;
  }

  async build(request: ContextBuildRequest): Promise<ContextBuildResult> {
    const result = await this.options.inner.build(request);
    const query = extractLastUserText(request.history);
    if (!query) {
      return result;
    }

    const entries = await this.options.memory.search(query, this.limit);
    if (entries.length === 0) {
      return result;
    }

    const memorySection = entries
      .map((entry) => `- ${entry.key}: ${entry.value}`)
      .join('\n');
    const systemPrompt = `${result.systemPrompt}\n\n## Memory\n${memorySection}`;
    const messages = prependSystem(result.messages, systemPrompt);
    return { systemPrompt, messages };
  }
}

function extractLastUserText(history: Message[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function prependSystem(history: Message[], systemPrompt: string): Message[] {
  const withoutSystem = history.filter((message) => message.role !== 'system');
  return [{ role: 'system', content: systemPrompt }, ...withoutSystem];
}
