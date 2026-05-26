from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable


@dataclass
class NormalizedMessage:
    channel: str
    peer: str
    text: str
    metadata: dict | None = None


class InMemoryChannelAdapter:
    def __init__(self, channel_id: str) -> None:
        self.id = channel_id
        self._handler: Callable[[NormalizedMessage], Awaitable[None]] | None = None

    async def start(self, on_message: Callable[[NormalizedMessage], Awaitable[None]]) -> None:
        self._handler = on_message

    async def stop(self) -> None:
        self._handler = None

    async def send(self, peer: str, text: str) -> None:
        del peer, text

    async def inject(self, peer: str, text: str) -> None:
        if self._handler is None:
            raise RuntimeError(f"Channel {self.id} is not started")
        await self._handler(NormalizedMessage(channel=self.id, peer=peer, text=text))
