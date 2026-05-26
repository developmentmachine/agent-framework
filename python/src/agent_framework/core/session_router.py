from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import AsyncIterator

from agent_framework.core.contracts import AgentLoop, EventBus, LifecycleEvent, RunManager, SessionLane, StreamEvent
from agent_framework.core.domain import AgentRunRequest


class DefaultSessionRouter:
    def __init__(self, lane: SessionLane, loop: AgentLoop, runs: RunManager, bus: EventBus) -> None:
        self._lane = lane
        self._loop = loop
        self._runs = runs
        self._bus = bus

    async def route(self, request: AgentRunRequest) -> AsyncIterator[StreamEvent]:
        run = self._runs.create(request.session_id)
        self._runs.update(run.run_id, {"status": "running"})

        queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()

        async def producer() -> None:
            try:
                async for event in self._loop.run(request):
                    self._bus.publish(event)
                    await queue.put(event)
            except Exception as exc:  # noqa: BLE001
                await queue.put(LifecycleEvent(phase="error", run_id=run.run_id, error=str(exc)))
            finally:
                await queue.put(None)

        async def run_in_lane() -> None:
            await producer()

        lane_task = asyncio.create_task(self._lane.enqueue(request.session_id, run_in_lane))

        while True:
            event = await queue.get()
            if event is None:
                break
            yield event

        await lane_task

        self._runs.update(run.run_id, {
            "status": "completed",
            "ended_at": datetime.now(timezone.utc).isoformat(),
        })
