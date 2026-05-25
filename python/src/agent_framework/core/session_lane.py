from __future__ import annotations

import asyncio


class DefaultSessionLane:
    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Task | None] = {}

    async def enqueue(self, session_id: str, task):
        previous = self._queues.get(session_id)
        if previous is not None:
            try:
                await previous
            except Exception:
                pass

        current = asyncio.create_task(task())
        self._queues[session_id] = current
        try:
            return await current
        finally:
            if self._queues.get(session_id) is current:
                self._queues.pop(session_id, None)
