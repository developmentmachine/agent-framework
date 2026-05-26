export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export type AgentMode = 'agent' | 'plan' | 'ask';

export interface AgentRunRequest {
  sessionId: string;
  input: UserMessage;
  mode?: AgentMode;
  abortSignal?: AbortSignal;
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TerminalReason =
  | { kind: 'completed' }
  | { kind: 'max_turns' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface ToolExecutionContext {
  sessionId: string;
  runId: string;
  workspaceRoot: string;
  abortSignal?: AbortSignal;
}

export interface ToolDefinitionSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export type ToolConcurrency = 'parallel' | 'serial';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolDefinitionSchema;
  concurrency?: ToolConcurrency;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelChunk {
  type: 'text_delta' | 'tool_call' | 'usage' | 'done';
  textDelta?: string;
  toolCall?: ToolCallRequest;
  usage?: TokenUsage;
}

export interface StreamRequest {
  messages: Message[];
  tools: ToolDefinition[];
  abortSignal?: AbortSignal;
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionCheckRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId: string;
}

export interface HookContext {
  sessionId: string;
  runId: string;
}

export type HookEvent =
  | { type: 'onRunStart'; context: HookContext }
  | { type: 'onRunEnd'; context: HookContext; reason: TerminalReason }
  | { type: 'preToolUse'; context: HookContext; toolName: string; arguments: Record<string, unknown> }
  | { type: 'postToolUse'; context: HookContext; toolName: string; result: unknown; error?: string };

export interface PluginManifest {
  id: string;
  version: string;
  name: string;
  capabilities: string[];
  configSchema?: Record<string, unknown>;
}

export interface AgentConfig {
  workspaceRoot: string;
  maxTurns: number;
  model: string;
  provider: string;
  toolTimeoutMs: number;
  runTimeoutMs: number;
  tokenBudget: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  workspaceRoot: process.cwd(),
  maxTurns: 25,
  model: 'gpt-4o-mini',
  provider: 'openai',
  toolTimeoutMs: 60_000,
  runTimeoutMs: 600_000,
  tokenBudget: 100_000,
};
