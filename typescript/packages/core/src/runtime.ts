import type { AgentConfig, AgentRunRequest, TerminalReason } from './types/domain.js';
import { DEFAULT_AGENT_CONFIG } from './types/domain.js';
import type {
  AgentLoop,
  ContextEngine,
  EventBus,
  HookRunner,
  MemoryProvider,
  ModelProvider,
  PermissionPolicy,
  RunManager,
  SessionLane,
  SessionRouter,
  SessionStore,
  StreamEvent,
  ToolRegistry,
} from './types/contracts.js';
import { DefaultAgentLoop } from './agent-loop.js';
import { WorkspaceContextEngine } from './context-engine.js';
import { InMemoryEventBus } from './event-bus.js';
import { DefaultHookRunner } from './hook-runner.js';
import { InMemoryMemoryProvider } from './in-memory-memory.js';
import { InMemorySessionStore } from './in-memory-session.js';
import { DefaultPermissionPolicy, DEFAULT_CODING_POLICY_RULES } from './permission-policy.js';
import { DefaultRunManager } from './run-manager.js';
import { DefaultSessionLane } from './session-lane.js';
import { DefaultSessionRouter } from './session-router.js';
import { DefaultToolRegistry } from './tool-registry.js';

export interface AgentRuntime {
  config: AgentConfig;
  provider: ModelProvider;
  tools: ToolRegistry;
  sessions: SessionStore;
  memory: MemoryProvider;
  hooks: HookRunner;
  policy: PermissionPolicy;
  contextEngine: ContextEngine;
  loop: AgentLoop;
  lane: SessionLane;
  runs: RunManager;
  bus: EventBus;
  router: SessionRouter;
}

export interface CreateAgentRuntimeOptions {
  config?: Partial<AgentConfig>;
  tools?: ToolRegistry;
  sessions?: SessionStore;
  memory?: MemoryProvider;
  hooks?: HookRunner;
  policy?: PermissionPolicy;
  onAskPermission?: (request: import('./types/domain.js').PermissionCheckRequest) => Promise<boolean>;
}

export function createAgentRuntime(
  provider: ModelProvider,
  options: CreateAgentRuntimeOptions = {},
): AgentRuntime {
  const config: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...options.config,
  };

  const tools = options.tools ?? new DefaultToolRegistry();
  const sessions = options.sessions ?? new InMemorySessionStore();
  const memory = options.memory ?? new InMemoryMemoryProvider();
  const hooks = options.hooks ?? new DefaultHookRunner();
  const policy = options.policy ?? new DefaultPermissionPolicy(DEFAULT_CODING_POLICY_RULES);
  const contextEngine = new WorkspaceContextEngine({ workspaceRoot: config.workspaceRoot });
  const lane = new DefaultSessionLane();
  const runs = new DefaultRunManager();
  const bus = new InMemoryEventBus();

  const loop = new DefaultAgentLoop({
    provider,
    tools,
    sessionStore: sessions,
    contextEngine,
    hooks,
    policy,
    config,
    onAskPermission: options.onAskPermission,
  });

  const router = new DefaultSessionRouter(lane, loop, runs, bus);

  return {
    config,
    provider,
    tools,
    sessions,
    memory,
    hooks,
    policy,
    contextEngine,
    loop,
    lane,
    runs,
    bus,
    router,
  };
}

export async function runAgent(
  runtime: AgentRuntime,
  request: AgentRunRequest,
): Promise<{ events: StreamEvent[]; reason: TerminalReason }> {
  const events: StreamEvent[] = [];
  const generator = runtime.router.route(request);
  let result = await generator.next();
  while (!result.done) {
    events.push(result.value);
    result = await generator.next();
  }
  return { events, reason: result.value ?? { kind: 'completed' } };
}
