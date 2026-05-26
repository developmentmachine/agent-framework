export interface CronJob {
  id: string;
  intervalMs: number;
  prompt: string;
  sessionId: string;
  enabled: boolean;
}

export type CronHandler = (job: CronJob) => Promise<void>;

export class CronScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly handler: CronHandler) {}

  register(job: CronJob): void {
    this.unregister(job.id);
    if (!job.enabled) {
      return;
    }
    const timer = setInterval(() => {
      void this.handler(job);
    }, job.intervalMs);
    this.timers.set(job.id, timer);
  }

  unregister(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(jobId);
    }
  }

  stopAll(): void {
    for (const jobId of [...this.timers.keys()]) {
      this.unregister(jobId);
    }
  }
}
