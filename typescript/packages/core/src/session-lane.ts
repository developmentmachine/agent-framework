import type { SessionLane } from './types/contracts.js';

export class DefaultSessionLane implements SessionLane {
  private queues = new Map<string, Promise<unknown>>();

  enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task);
    this.queues.set(sessionId, next);
    return next.finally(() => {
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId);
      }
    }) as Promise<T>;
  }
}
