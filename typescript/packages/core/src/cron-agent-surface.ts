import type { AgentRuntime } from './runtime.js';
import { CronScheduler, type CronJob } from './cron-scheduler.js';

export interface CronAgentSurfaceOptions {
  runtime: AgentRuntime;
}

export class CronAgentSurface {
  private readonly scheduler: CronScheduler;

  constructor(private readonly options: CronAgentSurfaceOptions) {
    this.scheduler = new CronScheduler(async (job) => {
      const generator = this.options.runtime.router.route({
        sessionId: job.sessionId,
        input: { role: 'user', content: job.prompt },
      });
      let result = await generator.next();
      while (!result.done) {
        result = await generator.next();
      }
      void result.value;
    });
  }

  register(job: CronJob): void {
    this.scheduler.register(job);
  }

  unregister(jobId: string): void {
    this.scheduler.unregister(jobId);
  }

  stopAll(): void {
    this.scheduler.stopAll();
  }
}
