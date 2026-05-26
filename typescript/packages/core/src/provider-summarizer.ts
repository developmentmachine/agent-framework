import type { ModelProvider } from './types/contracts.js';
import type { Message } from './types/domain.js';
import type { SummarizeMessages } from './llm-summarization-compactor.js';

function messageToText(message: Message): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

export function createProviderSummarizer(provider: ModelProvider): SummarizeMessages {
  return async (messages: Message[]) => {
    const transcript = messages.map((message) => `${message.role}: ${messageToText(message)}`).join('\n');
    let summary = '';

    for await (const chunk of provider.stream({
      messages: [
        {
          role: 'system',
          content: 'Summarize the following conversation for future context. Keep key facts and decisions.',
        },
        { role: 'user', content: transcript },
      ],
      tools: [],
    })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        summary += chunk.textDelta;
      }
    }

    return summary.trim() || transcript.slice(0, 500);
  };
}
