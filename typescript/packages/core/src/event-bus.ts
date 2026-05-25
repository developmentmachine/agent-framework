import type { EventBus, StreamEvent } from './types/contracts.js';

export class InMemoryEventBus implements EventBus {
  private listeners = new Set<(event: StreamEvent) => void>();

  subscribe(listener: (event: StreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: StreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
