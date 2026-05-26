import type { AgentRunRequest, TerminalReason } from './types/domain.js';
import type { AgentLoop, EventBus, RunManager, SessionLane, SessionRouter, StreamEvent } from './types/contracts.js';

export class DefaultSessionRouter implements SessionRouter {
  constructor(
    private readonly lane: SessionLane,
    private readonly loop: AgentLoop,
    private readonly runs: RunManager,
    private readonly bus: EventBus,
  ) {}

  async *route(request: AgentRunRequest): AsyncGenerator<StreamEvent, TerminalReason, unknown> {
    const run = this.runs.create(request.sessionId);
    this.runs.update(run.runId, { status: 'running' });

    const queue: StreamEvent[] = [];
    let finished = false;
    let wake: (() => void) | undefined;
    const state: { terminal: TerminalReason } = { terminal: { kind: 'completed' } };

    const signal = (): void => {
      wake?.();
      wake = undefined;
    };

    void this.lane.enqueue(request.sessionId, async () => {
      try {
        const generator = this.loop.run(request);
        let result = await generator.next();
        while (!result.done) {
          this.bus.publish(result.value);
          queue.push(result.value);
          signal();
          result = await generator.next();
        }
        state.terminal = result.value ?? { kind: 'completed' };
      } catch (error) {
        state.terminal = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        finished = true;
        signal();
      }
    });

    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (finished) {
        break;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        queueMicrotask(() => {
          if (queue.length > 0 || finished) {
            resolve();
          }
        });
      });
    }

    const terminal = state.terminal;
    const status =
      terminal.kind === 'error'
        ? 'failed'
        : terminal.kind === 'cancelled'
          ? 'cancelled'
          : 'completed';

    this.runs.update(run.runId, {
      status,
      endedAt: new Date().toISOString(),
      error: terminal.kind === 'error' ? terminal.message : undefined,
    });

    return terminal;
  }
}
