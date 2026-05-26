from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable


@dataclass
class CronJob:
    id: str
    interval_ms: int
    prompt: str
    session_id: str
    enabled: bool = True


class CronScheduler:
    def __init__(self, handler: Callable[[CronJob], Awaitable[None]]) -> None:
        self._handler = handler
        self._tasks: dict[str, asyncio.Task] = {}

    def register(self, job: CronJob) -> None:
        self.unregister(job.id)
        if not job.enabled:
            return

        async def loop() -> None:
            while True:
                await asyncio.sleep(job.interval_ms / 1000)
                await self._handler(job)

        self._tasks[job.id] = asyncio.create_task(loop())

    def unregister(self, job_id: str) -> None:
        task = self._tasks.pop(job_id, None)
        if task is not None:
            task.cancel()
