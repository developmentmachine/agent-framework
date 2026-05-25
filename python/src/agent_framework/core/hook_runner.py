from __future__ import annotations

from agent_framework.core.contracts import HookHandler


class DefaultHookRunner:
    def __init__(self) -> None:
        self._handlers: dict[str, HookHandler] = {}

    def register(self, handler: HookHandler) -> None:
        self._handlers[handler.id] = handler

    async def emit(self, event: dict) -> None:
        for handler in sorted(self._handlers.values(), key=lambda item: item.id):
            await handler.handle(event)
