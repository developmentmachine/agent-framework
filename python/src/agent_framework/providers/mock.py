from __future__ import annotations

from typing import AsyncIterator
from uuid import uuid4

from agent_framework.core.domain import Message, ModelChunk, ToolCallRequest, ToolDefinition


class MockProvider:
    id = "mock"

    def __init__(self, responses: list[dict] | None = None) -> None:
        self._responses = responses or []
        self._turn = 0

    async def stream(self, messages: list[Message], tools: list[ToolDefinition]) -> AsyncIterator[ModelChunk]:
        del messages, tools
        scripted = self._responses[self._turn] if self._turn < len(self._responses) else None
        self._turn += 1

        if scripted is None:
            yield ModelChunk(type="text_delta", text_delta="Done.")
            yield ModelChunk(type="usage", usage={"input": 1, "output": 1, "total": 2})
            yield ModelChunk(type="done")
            return

        if scripted.get("text"):
            yield ModelChunk(type="text_delta", text_delta=scripted["text"])

        for call in scripted.get("tool_calls", []):
            yield ModelChunk(
                type="tool_call",
                tool_call=ToolCallRequest(
                    id=str(uuid4()),
                    name=call["name"],
                    arguments=call["arguments"],
                ),
            )

        yield ModelChunk(type="usage", usage={"input": 10, "output": 5, "total": 15})
        yield ModelChunk(type="done")
