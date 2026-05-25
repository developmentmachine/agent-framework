import { randomUUID } from 'node:crypto';
import type { RunManager, RunRecord } from './types/contracts.js';
import type { RunStatus } from './types/domain.js';

export class DefaultRunManager implements RunManager {
  private runs = new Map<string, RunRecord>();
  private waiters = new Map<string, Array<(record: RunRecord) => void>>();

  create(sessionId: string): RunRecord {
    const record: RunRecord = {
      runId: randomUUID(),
      sessionId,
      status: 'pending',
      startedAt: new Date().toISOString(),
    };
    this.runs.set(record.runId, record);
    return record;
  }

  update(runId: string, patch: Partial<RunRecord>): void {
    const existing = this.runs.get(runId);
    if (!existing) {
      return;
    }
    const updated = { ...existing, ...patch };
    this.runs.set(runId, updated);
    if (isTerminal(updated.status)) {
      for (const resolve of this.waiters.get(runId) ?? []) {
        resolve(updated);
      }
      this.waiters.delete(runId);
    }
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  wait(runId: string, timeoutMs = 600_000): Promise<RunRecord> {
    const existing = this.runs.get(runId);
    if (existing && isTerminal(existing.status)) {
      return Promise.resolve(existing);
    }
    return new Promise<RunRecord>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Run ${runId} timed out`)), timeoutMs);
      const list = this.waiters.get(runId) ?? [];
      list.push((record) => {
        clearTimeout(timeout);
        resolve(record);
      });
      this.waiters.set(runId, list);
    });
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
