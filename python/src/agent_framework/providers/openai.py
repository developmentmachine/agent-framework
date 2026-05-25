from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from agent_framework.core.domain import Message, ModelChunk, ToolCallRequest, ToolDefinition


class OpenAIProvider:
    id = "openai"

    def __init__(self, api_key: str, model: str, base_url: str = "https://api.openai.com/v1") -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url

    async def stream(self, messages: list[Message], tools: list[ToolDefinition]) -> AsyncIterator[ModelChunk]:
        payload = {
            "model": self._model,
            "messages": _to_openai_messages(messages),
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    },
                }
                for tool in tools
            ],
            "stream": True,
        }
        tool_calls: dict[int, dict] = {}
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        yield ModelChunk(type="text_delta", text_delta=delta["content"])
                    for tool_call in delta.get("tool_calls", []) or []:
                        index = tool_call.get("index", 0)
                        existing = tool_calls.setdefault(
                            index,
                            {"id": tool_call.get("id"), "name": "", "arguments": ""},
                        )
                        if tool_call.get("function", {}).get("name"):
                            existing["name"] = tool_call["function"]["name"]
                        if tool_call.get("function", {}).get("arguments"):
                            existing["arguments"] += tool_call["function"]["arguments"]
                    usage = chunk.get("usage")
                    if usage:
                        yield ModelChunk(
                            type="usage",
                            usage={
                                "input": usage.get("prompt_tokens", 0),
                                "output": usage.get("completion_tokens", 0),
                                "total": usage.get("total_tokens", 0),
                            },
                        )
        for tool_call in tool_calls.values():
            yield ModelChunk(
                type="tool_call",
                tool_call=ToolCallRequest(
                    id=tool_call["id"] or "tool-call",
                    name=tool_call["name"],
                    arguments=json.loads(tool_call["arguments"] or "{}"),
                ),
            )
        yield ModelChunk(type="done")


def _to_openai_messages(messages: list[Message]):
    converted = []
    for message in messages:
        if isinstance(message.content, str):
            converted.append({"role": message.role, "content": message.content})
        else:
            converted.append({"role": message.role, "content": str(message.content)})
    return converted
