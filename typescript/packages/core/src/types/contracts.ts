import type {
  AgentRunRequest,
  HookContext,
  HookEvent,
  Message,
  ModelChunk,
  PermissionCheckRequest,
  PermissionDecision,
  StreamRequest,
  TerminalReason,
  TokenUsage,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionContext,
} from './domain.js';

export type LifecyclePhase = 'start' | 'end' | 'error';

export type StreamEvent =
  | { type: 'lifecycle'; phase: LifecyclePhase; runId: string; error?: string }
  | { type: 'assistant'; delta: string }
  | { type: 'tool'; callId: string; name: string; status: 'start' | 'end' | 'error'; output?: unknown }
  | { type: 'usage'; tokens: TokenUsage };

export interface ModelProvider {
  readonly id: string;
  stream(request: StreamRequest): AsyncGenerator<ModelChunk, void, unknown>;
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<unknown>;
}

export interface SessionRecord {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionRecord | null>;
  save(session: SessionRecord): Promise<void>;
  appendMessages(sessionId: string, messages: Message[]): Promise<void>;
  list(): Promise<SessionRecord[]>;
}

export interface MemoryEntry {
  key: string;
  value: string;
  scope: 'working' | 'persistent';
  updatedAt: string;
}

export interface MemoryProvider {
  get(key: string, scope?: 'working' | 'persistent'): Promise<string | null>;
  set(key: string, value: string, scope?: 'working' | 'persistent'): Promise<void>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  clear(scope?: 'working' | 'persistent'): Promise<void>;
}

export interface ContextBuildRequest {
  sessionId: string;
  mode?: AgentRunRequest['mode'];
  history: Message[];
}

export interface ContextBuildResult {
  systemPrompt: string;
  messages: Message[];
}

export interface ContextEngine {
  build(request: ContextBuildRequest): Promise<ContextBuildResult>;
}

export interface ContextCompactor {
  compact(messages: Message[], tokenBudget: number): Promise<Message[]>;
}

export interface PermissionPolicy {
  check(request: PermissionCheckRequest): Promise<PermissionDecision>;
}

export interface HookHandler {
  id: string;
  handle(event: HookEvent): Promise<void>;
}

export interface HookRunner {
  register(handler: HookHandler): void;
  emit(event: HookEvent): Promise<void>;
}

export interface SandboxBackend {
  execute(
    command: string,
    options: { cwd: string; timeoutMs: number; abortSignal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface SubAgentRequest {
  prompt: string;
  sessionId: string;
  parentRunId: string;
  tools?: string[];
}

export interface SubAgentRunner {
  run(request: SubAgentRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): void;
  list(toolset?: string[]): ToolDefinition[];
  get(name: string): Tool | undefined;
  execute(
    ctx: ToolExecutionContext,
    call: ToolCallRequest,
  ): Promise<{ output: unknown; error?: string }>;
}

export interface AgentLoopDeps {
  provider: ModelProvider;
  tools: ToolRegistry;
  sessionStore: SessionStore;
  contextEngine: ContextEngine;
  hooks: HookRunner;
  policy: PermissionPolicy;
  config: import('./domain.js').AgentConfig;
  compactor?: ContextCompactor;
  onAskPermission?: (request: PermissionCheckRequest) => Promise<boolean>;
}

export interface AgentLoop {
  run(request: AgentRunRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown>;
}

export interface EventBus {
  subscribe(listener: (event: StreamEvent) => void): () => void;
  publish(event: StreamEvent): void;
}

export interface SessionLane {
  enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
}

export interface RunRecord {
  runId: string;
  sessionId: string;
  status: import('./domain.js').RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface RunManager {
  create(sessionId: string): RunRecord;
  update(runId: string, patch: Partial<RunRecord>): void;
  get(runId: string): RunRecord | undefined;
  wait(runId: string, timeoutMs?: number): Promise<RunRecord>;
}

export interface SessionRouter {
  route(request: AgentRunRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown>;
}

export interface PluginContext {
  registerTool(tool: Tool): void;
  registerHook(handler: HookHandler): void;
  registerProvider(provider: ModelProvider): void;
}

export interface Plugin {
  manifest: import('./domain.js').PluginManifest;
  register(ctx: PluginContext): void | Promise<void>;
}

export type AgentErrorCode =
  | 'CANCELLED'
  | 'PERMISSION_DENIED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_EXECUTION_FAILED'
  | 'PROVIDER_ERROR'
  | 'MAX_TURNS'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT';

export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode,
    readonly recoverable = false,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type { HookContext, ToolCallRequest };

export type { PermissionCheckRequest, PermissionDecision, ToolExecutionContext };
