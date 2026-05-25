import type { HookHandler, HookRunner } from './types/contracts.js';
import type { HookEvent } from './types/domain.js';

export class DefaultHookRunner implements HookRunner {
  private handlers = new Map<string, HookHandler>();

  register(handler: HookHandler): void {
    this.handlers.set(handler.id, handler);
  }

  async emit(event: HookEvent): Promise<void> {
    const handlers = [...this.handlers.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const handler of handlers) {
      await handler.handle(event);
    }
  }
}
