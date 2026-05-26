from __future__ import annotations

from agent_framework.core.domain import Message


def estimate_tokens(message: Message) -> int:
    content = message.content if isinstance(message.content, str) else str(message.content)
    return max(1, len(content) // 4)


class TruncateMiddleCompactor:
    async def compact(self, messages: list[Message], token_budget: int) -> list[Message]:
        if len(messages) <= 2:
            return messages

        system = [message for message in messages if message.role == "system"]
        rest = [message for message in messages if message.role != "system"]
        total = sum(estimate_tokens(message) for message in messages)
        if total <= token_budget:
            return messages

        head = rest[:1]
        tail = rest[-4:]
        dropped = len(rest) - len(head) - len(tail)
        summary = Message(
            role="system",
            content=f"[Context compacted: {dropped} middle messages summarized to stay within token budget.]",
        )
        compacted = [*system, *head, summary, *tail]
        while sum(estimate_tokens(message) for message in compacted) > token_budget and len(compacted) > 2:
            removable = next(
                (
                    index
                    for index, message in enumerate(compacted)
                    if message.role != "system" and 0 < index < len(compacted) - 2
                ),
                None,
            )
            if removable is None:
                break
            compacted.pop(removable)
        return compacted
