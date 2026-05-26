from __future__ import annotations

from agent_framework.core.contracts import ContextEngine, MemoryProvider
from agent_framework.core.domain import AgentMode, Message


class MemoryAugmentedContextEngine(ContextEngine):
    def __init__(self, inner: ContextEngine, memory: MemoryProvider, limit: int = 5) -> None:
        self._inner = inner
        self._memory = memory
        self._limit = limit

    async def build(self, session_id: str, mode: AgentMode, history: list[Message]) -> tuple[str, list[Message]]:
        system_prompt, messages = await self._inner.build(session_id, mode, history)
        query = _extract_last_user_text(history)
        if not query:
            return system_prompt, messages

        entries = await self._memory.search(query, self._limit)
        if not entries:
            return system_prompt, messages

        memory_section = "\n".join(f"- {entry['key']}: {entry['value']}" for entry in entries)
        augmented = f"{system_prompt}\n\n## Memory\n{memory_section}"
        filtered = [message for message in messages if message.role != "system"]
        return augmented, [Message(role="system", content=augmented), *filtered]


def _extract_last_user_text(history: list[Message]) -> str:
    for message in reversed(history):
        if message.role == "user" and isinstance(message.content, str) and message.content.strip():
            return message.content.strip()
    return ""
