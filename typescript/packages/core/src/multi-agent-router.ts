import type { AgentRuntime } from './runtime.js';
import type { AgentRunRequest, TerminalReason } from './types/domain.js';
import type { StreamEvent } from './types/contracts.js';

export interface AgentRouteRule {
  agentId: string;
  runtime: AgentRuntime;
  channel?: string;
  sessionPrefix?: string;
}

export interface RoutedAgentRequest extends AgentRunRequest {
  agentId?: string;
  channel?: string;
}

export class MultiAgentRouter {
  constructor(
    private readonly routes: AgentRouteRule[],
    private readonly fallback: AgentRuntime,
  ) {}

  resolve(request: RoutedAgentRequest): AgentRuntime {
    if (request.agentId) {
      const byId = this.routes.find((route) => route.agentId === request.agentId);
      if (byId) {
        return byId.runtime;
      }
    }

    for (const route of this.routes) {
      if (route.channel && request.channel && route.channel === request.channel) {
        return route.runtime;
      }
      if (route.sessionPrefix && request.sessionId.startsWith(route.sessionPrefix)) {
        return route.runtime;
      }
    }

    return this.fallback;
  }

  async *route(request: RoutedAgentRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown> {
    const runtime = this.resolve(request);
    return yield* runtime.router.route(request);
  }
}
