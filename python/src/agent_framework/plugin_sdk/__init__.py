from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PluginManifest:
    id: str
    version: str
    name: str
    capabilities: list[str]


class PluginLoader:
    def __init__(self, search_paths: list[str]) -> None:
        self._search_paths = search_paths

    async def load_all(self) -> list[dict[str, Any]]:
        return []


class MCPClient:
    def __init__(self, command: str, args: list[str] | None = None) -> None:
        self.command = command
        self.args = args or []

    async def list_tools(self) -> list[dict[str, Any]]:
        return []

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        raise NotImplementedError("MCP transport not configured")


class SubAgentToolFactory:
    def __init__(self, run_prompt) -> None:
        self._run_prompt = run_prompt

    def create_delegate_tool(self):
        from agent_framework.core.domain import ToolDefinition
        from agent_framework.core.tool_registry import create_pydantic_tool
        from pydantic import BaseModel

        class DelegateArgs(BaseModel):
            prompt: str

        async def execute(args: DelegateArgs, ctx):
            return await self._run_prompt(args.prompt, f"{ctx.session_id}:sub")

        return create_pydantic_tool(
            ToolDefinition(
                name="delegate",
                description="Spawn an isolated sub-agent",
                parameters={"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
                concurrency="serial",
            ),
            DelegateArgs,
            execute,
        )
