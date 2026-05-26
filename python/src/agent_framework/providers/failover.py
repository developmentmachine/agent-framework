from __future__ import annotations

from typing import AsyncIterator

from agent_framework.core.domain import ModelChunk
from agent_framework.core.contracts import Message, ToolDefinition


class FailoverProvider:
    id = "failover"

    def __init__(self, providers: list, max_attempts: int | None = None) -> None:
        if not providers:
            raise ValueError("FailoverProvider requires at least one provider")
        self._providers = providers
        self._max_attempts = max_attempts or len(providers)

    async def stream(self, messages: list[Message], tools: list[ToolDefinition]) -> AsyncIterator[ModelChunk]:
        last_error: Exception | None = None
        for provider in self._providers[: self._max_attempts]:
            try:
                async for chunk in provider.stream(messages, tools):
                    yield chunk
                return
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise last_error or RuntimeError("All providers failed")
