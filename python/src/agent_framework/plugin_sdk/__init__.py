from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent_framework.plugin_sdk.mcp_stdio import MCPClient, register_mcp_tools

__all__ = ["PluginManifest", "PluginLoader", "MCPClient", "register_mcp_tools", "SubAgentToolFactory"]


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
