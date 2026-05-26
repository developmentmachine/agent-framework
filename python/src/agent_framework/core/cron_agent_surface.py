from __future__ import annotations

from agent_framework.core.cron_scheduler import CronJob, CronScheduler
from agent_framework.core.domain import AgentRunRequest


class CronAgentSurface:
    def __init__(self, runtime) -> None:
        self._runtime = runtime
        self._scheduler = CronScheduler(self._handle_job)

    async def _handle_job(self, job: CronJob) -> None:
        async for _event in self._runtime.router.route(
            AgentRunRequest(session_id=job.session_id, input={"role": "user", "content": job.prompt})
        ):
            pass

    def register(self, job: CronJob) -> None:
        self._scheduler.register(job)

    def unregister(self, job_id: str) -> None:
        self._scheduler.unregister(job_id)

    def stop_all(self) -> None:
        for job_id in list(self._scheduler._tasks.keys()):
            self._scheduler.unregister(job_id)
