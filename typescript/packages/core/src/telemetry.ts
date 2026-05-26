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

export interface SpanExporter {
  export(spans: TelemetrySpan[]): Promise<void> | void;
  shutdown?(): Promise<void> | void;
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

export class ConsoleSpanExporter implements SpanExporter {
  export(spans: TelemetrySpan[]): void {
    for (const span of spans) {
      if (!span.endMs) {
        continue;
      }
      const durationMs = span.endMs - span.startMs;
      console.info(`[otel] ${span.name} ${durationMs}ms`, span.attributes ?? {});
    }
  }
}

export class HttpOtelExporter implements SpanExporter {
  constructor(private readonly endpoint: string) {}

  async export(spans: TelemetrySpan[]): Promise<void> {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: spans
                .filter((span) => span.endMs !== undefined)
                .map((span) => ({
                  name: span.name,
                  startTimeUnixNano: `${Math.floor(span.startMs * 1_000_000)}`,
                  endTimeUnixNano: `${Math.floor((span.endMs ?? span.startMs) * 1_000_000)}`,
                  attributes: Object.entries(span.attributes ?? {}).map(([key, value]) => ({
                    key,
                    value: { stringValue: String(value) },
                  })),
                })),
            },
          ],
        },
      ],
    };

    if (payload.resourceSpans[0]?.scopeSpans[0]?.spans.length === 0) {
      return;
    }

    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

export function attachTelemetry(
  bus: { subscribe(listener: (event: StreamEvent) => void): () => void },
  collector: TelemetryCollector,
): () => void {
  return bus.subscribe((event) => collector.onStreamEvent(event));
}

export interface TelemetryPipeline {
  collector: InMemoryTelemetryCollector;
  detach: () => void;
  flush: () => Promise<void>;
}

export function createTelemetryPipeline(
  bus: { subscribe(listener: (event: StreamEvent) => void): () => void },
  exporters: SpanExporter[] = [new ConsoleSpanExporter()],
): TelemetryPipeline {
  const collector = new InMemoryTelemetryCollector();
  const detach = attachTelemetry(bus, collector);

  return {
    collector,
    detach,
    async flush() {
      const finished = collector.spans().filter((span) => span.endMs !== undefined);
      await Promise.all(exporters.map((exporter) => exporter.export(finished)));
    },
  };
}
