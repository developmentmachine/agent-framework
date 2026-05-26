import type { StreamEvent } from './types/contracts.js';
import type { HookEvent } from './types/domain.js';

export interface TelemetrySpan {
  name: string;
  startMs: number;
  endMs?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TelemetryCollector {
  onStreamEvent(event: StreamEvent): void;
  onHook(event: HookEvent): void;
  spans(): TelemetrySpan[];
}

export class InMemoryTelemetryCollector implements TelemetryCollector {
  private readonly _spans: TelemetrySpan[] = [];
  private readonly events: StreamEvent[] = [];

  onStreamEvent(event: StreamEvent): void {
    this.events.push(event);
    if (event.type === 'lifecycle' && event.phase === 'start') {
      this._spans.push({ name: `run:${event.runId}`, startMs: Date.now() });
    }
    if (event.type === 'lifecycle' && (event.phase === 'end' || event.phase === 'error')) {
      const span = [...this._spans].reverse().find((item) => !item.endMs);
      if (span) {
        span.endMs = Date.now();
      }
    }
    if (event.type === 'tool' && event.status === 'start') {
      this._spans.push({ name: `tool:${event.name}`, startMs: Date.now(), attributes: { callId: event.callId } });
    }
    if (event.type === 'tool' && event.status !== 'start') {
      const span = [...this._spans].reverse().find((item) => item.name === `tool:${event.name}` && !item.endMs);
      if (span) {
        span.endMs = Date.now();
      }
    }
  }

  onHook(event: HookEvent): void {
    void event;
  }

  spans(): TelemetrySpan[] {
    return [...this._spans];
  }

  streamEvents(): StreamEvent[] {
    return [...this.events];
  }
}

export function attachTelemetry(bus: { subscribe(listener: (event: StreamEvent) => void): () => void }, collector: TelemetryCollector): () => void {
  return bus.subscribe((event) => collector.onStreamEvent(event));
}
