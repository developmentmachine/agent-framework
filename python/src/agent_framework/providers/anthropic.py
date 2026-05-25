from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from agent_framework.core.domain import Message, ModelChunk, ToolCallRequest, ToolDefinition


class AnthropicProvider:
    id = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str = "https://api.anthropic.com/v1") -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url

    async def stream(self, messages: list[Message], tools: list[ToolDefinition]) -> AsyncIterator[ModelChunk]:
        system = next(
            (m.content for m in messages if m.role == "system" and isinstance(m.content, str)),
            None,
        )
        payload = {
            "model": self._model,
            "max_tokens": 8192,
            "system": system,
            "messages": [
                {
                    "role": m.role if m.role != "tool" else "user",
                    "content": m.content if isinstance(m.content, str) else str(m.content),
                }
                for m in messages
                if m.role != "system"
            ],
            "tools": [
                {"name": tool.name, "description": tool.description, "input_schema": tool.parameters}
                for tool in tools
            ],
            "stream": True,
        }
        current_tool = None
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/messages",
                headers={"x-api-key": self._api_key, "anthropic-version": "2023-06-01"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    event = json.loads(line[5:].strip())
                    if event.get("type") == "content_block_delta" and event.get("delta", {}).get("type") == "text_delta":
                        yield ModelChunk(type="text_delta", text_delta=event["delta"]["text"])
                    if event.get("type") == "content_block_start" and event.get("content_block", {}).get("type") == "tool_use":
                        block = event["content_block"]
                        current_tool = {"id": block["id"], "name": block["name"], "arguments": ""}
                    if (
                        event.get("type") == "content_block_delta"
                        and event.get("delta", {}).get("type") == "input_json_delta"
                        and current_tool
                    ):
                        current_tool["arguments"] += event["delta"].get("partial_json", "")
                    if event.get("type") == "content_block_stop" and current_tool:
                        yield ModelChunk(
                            type="tool_call",
                            tool_call=ToolCallRequest(
                                id=current_tool["id"],
                                name=current_tool["name"],
                                arguments=json.loads(current_tool["arguments"] or "{}"),
                            ),
                        )
                        current_tool = None
        yield ModelChunk(type="done")
