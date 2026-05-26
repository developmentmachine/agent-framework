import { randomUUID } from 'node:crypto';
import type { AgentRuntime } from './runtime.js';
import type { StreamEvent, SubAgentRequest, SubAgentRunner } from './types/contracts.js';
import type { TerminalReason } from './types/domain.js';

export interface SubAgentHandle {
  sessionId: string;
  parentRunId: string;
  runId: string;
}

export class InProcessSubAgentRunner implements SubAgentRunner {
  private readonly completions = new Map<string, TerminalReason>();

  constructor(private readonly runtime: AgentRuntime) {}

  async *run(request: SubAgentRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown> {
    const generator = this.runtime.loop.run({
      sessionId: request.sessionId,
      input: { role: 'user', content: request.prompt },
    });

    let result = await generator.next();
    while (!result.done) {
      yield result.value;
      result = await generator.next();
    }

    return result.value ?? { kind: 'completed' };
  }

  async spawn(request: SubAgentRequest): Promise<SubAgentHandle> {
    const handle: SubAgentHandle = {
      sessionId: request.sessionId,
      parentRunId: request.parentRunId,
      runId: randomUUID(),
    };

    void (async () => {
      const generator = this.runtime.loop.run({
        sessionId: request.sessionId,
        input: { role: 'user', content: request.prompt },
      });
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }
      this.completions.set(handle.runId, result.value ?? { kind: 'completed' });
    })();

    return handle;
  }

  async wait(handle: SubAgentHandle, timeoutMs = 60_000): Promise<TerminalReason> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const reason = this.completions.get(handle.runId);
      if (reason) {
        return reason;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { kind: 'error', message: 'Sub-agent timed out' };
  }

  async cancel(handle: SubAgentHandle): Promise<void> {
    this.completions.set(handle.runId, { kind: 'cancelled' });
  }
}
