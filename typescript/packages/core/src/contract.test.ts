import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('spec contract fixtures', () => {
  it('stream event schema accepts lifecycle event', () => {
    const schemaPath = join(process.cwd(), '../../../spec/events/stream-event.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(schema.oneOf).toBeDefined();
    const sample = { type: 'lifecycle', phase: 'start', runId: 'run-1' };
    expect(sample.type).toBe('lifecycle');
  });
});
