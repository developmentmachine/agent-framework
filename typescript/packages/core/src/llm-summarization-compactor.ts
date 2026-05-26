import type { ContextCompactor } from './types/contracts.js';
import type { Message } from './types/domain.js';
import { estimateTokens } from './context-compactor.js';

export type SummarizeMessages = (messages: Message[]) => Promise<string>;

export interface LlmSummarizationCompactorOptions {
  summarize: SummarizeMessages;
  keepRecent?: number;
}

export class LlmSummarizationCompactor implements ContextCompactor {
  private readonly keepRecent: number;

  constructor(private readonly options: LlmSummarizationCompactorOptions) {
    this.keepRecent = options.keepRecent ?? 4;
  }

  async compact(messages: Message[], tokenBudget: number): Promise<Message[]> {
    const total = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (total <= tokenBudget || messages.length <= this.keepRecent + 1) {
      return messages;
    }

    const system = messages.filter((message) => message.role === 'system');
    const rest = messages.filter((message) => message.role !== 'system');
    const head = rest.slice(0, 1);
    const tail = rest.slice(-this.keepRecent);
    const middle = rest.slice(head.length, rest.length - tail.length);

    if (middle.length === 0) {
      return messages;
    }

    const summaryText = await this.options.summarize(middle);
    const summary: Message = {
      role: 'system',
      content: `[Summarized context]\n${summaryText}`,
    };

    const compacted = [...system, ...head, summary, ...tail];
    const compactedTotal = compacted.reduce((sum, message) => sum + estimateTokens(message), 0);
    if (compactedTotal > tokenBudget && compacted.length > 2) {
      return [...system, ...head, summary, ...tail.slice(-this.keepRecent)];
    }
    return compacted;
  }
}
