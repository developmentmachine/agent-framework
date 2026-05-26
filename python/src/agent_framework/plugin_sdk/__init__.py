from __future__ import annotations

import asyncio
import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent_framework.plugin_sdk.mcp_stdio import MCPClient, register_mcp_tools

__all__ = [
    "PluginManifest",
    "PluginLoader",
    "MCPClient",
    "register_mcp_tools",
    "SubAgentToolFactory",
    "bootstrap_plugins",
]


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
        plugins: list[dict[str, Any]] = []
        for search_path in self._search_paths:
            manifest_path = Path(search_path) / "agent.plugin.json"
            plugin_path = Path(search_path) / "plugin.py"
            if not manifest_path.exists() or not plugin_path.exists():
                continue
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            spec = importlib.util.spec_from_file_location(f"plugin_{manifest['id']}", plugin_path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            register = getattr(module, "register", None)
            if register is not None:
                plugins.append({"manifest": manifest, "register": register})
        return sorted(plugins, key=lambda item: item["manifest"]["id"])

    async def apply(self, registry, hooks, providers: list | None = None) -> None:
        providers = providers if providers is not None else []

        class Context:
            def register_tool(self, tool) -> None:
                registry.register(tool)

            def register_hook(self, handler) -> None:
                hooks.register(handler)

            def register_provider(self, provider) -> None:
                providers.append(provider)

        context = Context()
        for plugin in await self.load_all():
            result = plugin["register"](context)
            if asyncio.iscoroutine(result):
                await result


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


from agent_framework.plugin_sdk.bootstrap import bootstrap_plugins
