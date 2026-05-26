from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import AsyncIterator
from uuid import uuid4

from agent_framework.core.contracts import StreamEvent
from agent_framework.core.domain import AgentRunRequest, TerminalReason
from agent_framework.runtime import AgentRuntime


@dataclass
class SubAgentHandle:
    session_id: str
    parent_run_id: str
    run_id: str


class InProcessSubAgentRunner:
    def __init__(self, runtime: AgentRuntime) -> None:
        self._runtime = runtime
        self._completions: dict[str, TerminalReason] = {}

    async def run(self, request: dict) -> AsyncIterator[StreamEvent]:
        async for event in self._runtime.loop.run(
            AgentRunRequest(
                session_id=request["session_id"],
                input={"role": "user", "content": request["prompt"]},
            )
        ):
            yield event

    async def spawn(self, request: dict) -> SubAgentHandle:
        handle = SubAgentHandle(
            session_id=request["session_id"],
            parent_run_id=request["parent_run_id"],
            run_id=str(uuid4()),
        )

        async def _task() -> None:
            async for _event in self._runtime.loop.run(
                AgentRunRequest(
                    session_id=request["session_id"],
                    input={"role": "user", "content": request["prompt"]},
                )
            ):
                pass
            self._completions[handle.run_id] = {"kind": "completed"}

        asyncio.create_task(_task())
        return handle

    async def wait(self, handle: SubAgentHandle, timeout_ms: int = 60_000) -> TerminalReason:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        while loop.time() < deadline:
            reason = self._completions.get(handle.run_id)
            if reason is not None:
                return reason
            await asyncio.sleep(0.01)
        return {"kind": "error", "message": "Sub-agent timed out"}

    async def cancel(self, handle: SubAgentHandle) -> None:
        self._completions[handle.run_id] = {"kind": "cancelled"}
