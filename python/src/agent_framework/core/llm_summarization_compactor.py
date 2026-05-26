from __future__ import annotations

from collections.abc import Awaitable, Callable

from agent_framework.core.context_compactor import estimate_tokens
from agent_framework.core.domain import Message

SummarizeMessages = Callable[[list[Message]], Awaitable[str]]


class LlmSummarizationCompactor:
    def __init__(self, summarize: SummarizeMessages, *, keep_recent: int = 4) -> None:
        self._summarize = summarize
        self._keep_recent = keep_recent

    async def compact(self, messages: list[Message], token_budget: int) -> list[Message]:
        total = sum(estimate_tokens(message) for message in messages)
        if total <= token_budget or len(messages) <= self._keep_recent + 1:
            return messages

        system = [message for message in messages if message.role == "system"]
        rest = [message for message in messages if message.role != "system"]
        head = rest[:1]
        tail = rest[-self._keep_recent :]
        middle = rest[len(head) : len(rest) - len(tail)]

        if not middle:
            return messages

        summary_text = await self._summarize(middle)
        summary = Message(role="system", content=f"[Summarized context]\n{summary_text}")
        compacted = [*system, *head, summary, *tail]

        if sum(estimate_tokens(message) for message in compacted) > token_budget and len(compacted) > 2:
            return [*system, *head, summary, *tail[-self._keep_recent :]]
        return compacted
