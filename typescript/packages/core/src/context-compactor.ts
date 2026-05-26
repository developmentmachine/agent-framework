import type { ContextCompactor } from './types/contracts.js';
import type { Message } from './types/domain.js';

function estimateTokens(message: Message): number {
  const text =
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
  return Math.ceil(text.length / 4);
}

export class TruncateMiddleCompactor implements ContextCompactor {
  async compact(messages: Message[], tokenBudget: number): Promise<Message[]> {
    if (messages.length <= 2) {
      return messages;
    }

    const system = messages.filter((message) => message.role === 'system');
    const rest = messages.filter((message) => message.role !== 'system');

    let total = [...system, ...rest].reduce((sum, message) => sum + estimateTokens(message), 0);
    if (total <= tokenBudget) {
      return messages;
    }

    const head = rest.slice(0, 1);
    const tail = rest.slice(-4);
    const dropped = rest.length - head.length - tail.length;

    const summary: Message = {
      role: 'system',
      content: `[Context compacted: ${dropped} middle messages summarized to stay within token budget.]`,
    };

    const compacted = [...system, ...head, summary, ...tail];
    total = compacted.reduce((sum, message) => sum + estimateTokens(message), 0);

    while (total > tokenBudget && compacted.length > 2) {
      const removable = compacted.findIndex(
        (message, index) => message.role !== 'system' && index > 0 && index < compacted.length - 2,
      );
      if (removable === -1) {
        break;
      }
      compacted.splice(removable, 1);
      total = compacted.reduce((sum, message) => sum + estimateTokens(message), 0);
    }

    return compacted;
  }
}

export { estimateTokens };
