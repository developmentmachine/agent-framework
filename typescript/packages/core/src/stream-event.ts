import type { StreamEvent } from './types/contracts.js';

export function serializeStreamEvent(event: StreamEvent): Record<string, unknown> {
  return { ...event };
}
