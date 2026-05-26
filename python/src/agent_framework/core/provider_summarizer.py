from __future__ import annotations

import json

from agent_framework.core.domain import Message


def _message_to_text(message: Message) -> str:
    if isinstance(message.content, str):
        return message.content
    return json.dumps(message.content)


def create_provider_summarizer(provider):
    async def summarize(messages: list[Message]) -> str:
        transcript = "\n".join(f"{message.role}: {_message_to_text(message)}" for message in messages)
        summary = ""
        async for chunk in provider.stream(
            [
                Message(
                    role="system",
                    content="Summarize the following conversation for future context. Keep key facts and decisions.",
                ),
                Message(role="user", content=transcript),
            ],
            [],
        ):
            if chunk.type == "text_delta" and chunk.text_delta:
                summary += chunk.text_delta
        return summary.strip() or transcript[:500]

    return summarize
