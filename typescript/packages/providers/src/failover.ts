import type { ModelChunk, ModelProvider, StreamRequest } from '@agent-framework/core';

export interface FailoverProviderOptions {
  providers: ModelProvider[];
  maxAttempts?: number;
}

export class FailoverProvider implements ModelProvider {
  readonly id = 'failover';

  constructor(private readonly options: FailoverProviderOptions) {
    if (options.providers.length === 0) {
      throw new Error('FailoverProvider requires at least one provider');
    }
  }

  async *stream(request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown> {
    const attempts = this.options.maxAttempts ?? this.options.providers.length;
    let lastError: Error | undefined;

    for (let index = 0; index < Math.min(attempts, this.options.providers.length); index += 1) {
      const provider = this.options.providers[index]!;
      try {
        for await (const chunk of provider.stream(request)) {
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('All providers failed');
  }
}
