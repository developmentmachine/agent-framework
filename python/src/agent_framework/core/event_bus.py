from __future__ import annotations

from agent_framework.core.contracts import StreamEvent


class InMemoryEventBus:
    def __init__(self) -> None:
        self._listeners: set = set()

    def subscribe(self, listener):
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def publish(self, event: StreamEvent) -> None:
        for listener in list(self._listeners):
            listener(event)
