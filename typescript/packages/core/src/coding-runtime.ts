import { TruncateMiddleCompactor } from './context-compactor.js';
import { LlmSummarizationCompactor } from './llm-summarization-compactor.js';
import { createProviderSummarizer } from './provider-summarizer.js';
import { SqliteSessionStore } from './sqlite-session.js';
import { DefaultToolRegistry } from './tool-registry.js';
import { createAgentRuntime, type AgentRuntime, type CreateAgentRuntimeOptions } from './runtime.js';
import type { ModelProvider } from './types/contracts.js';

export interface CreateCodingRuntimeOptions extends CreateAgentRuntimeOptions {
  sqliteSessionPath?: string;
  summarizeWithProvider?: boolean;
}

export function createCodingRuntime(
  provider: ModelProvider,
  options: CreateCodingRuntimeOptions = {},
): AgentRuntime {
  const tools = options.tools ?? new DefaultToolRegistry();
  const sessions = options.sqliteSessionPath
    ? new SqliteSessionStore(options.sqliteSessionPath)
    : options.sessions;

  const compactor =
    options.compactor ??
    (options.summarizeWithProvider
      ? new LlmSummarizationCompactor({ summarize: createProviderSummarizer(provider) })
      : new TruncateMiddleCompactor());

  return createAgentRuntime(provider, {
    ...options,
    tools,
    sessions,
    compactor,
  });
}
