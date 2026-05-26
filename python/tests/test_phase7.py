import asyncio
import json
import tempfile
from pathlib import Path

from agent_framework.core.coding_runtime import create_coding_runtime
from agent_framework.core.sqlite_memory import SqliteMemoryProvider
from agent_framework.plugin_sdk.plugin_watcher import PluginWatcher
from agent_framework.providers.mock import MockProvider


def test_sqlite_memory_provider_search():
    with tempfile.TemporaryDirectory() as tmp:
        memory = SqliteMemoryProvider(str(Path(tmp) / "memory.db"))

        async def _run():
            await memory.set("project", "agent framework", scope="persistent")
            assert await memory.get("project", scope="persistent") == "agent framework"
            hits = await memory.search("framework")
            assert any(hit["key"] == "project" for hit in hits)
            memory.close()

        asyncio.run(_run())


def test_plugin_watcher_reloads_tools():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "agent.plugin.json").write_text(
            json.dumps({"id": "sample", "version": "0.1.0", "name": "Sample", "capabilities": ["tools"]}),
            encoding="utf-8",
        )
        (root / "plugin.py").write_text(
            """
from agent_framework.core.domain import ToolDefinition
from agent_framework.core.tool_registry import create_pydantic_tool
from pydantic import BaseModel

class EmptyArgs(BaseModel):
    pass

async def register(ctx):
    async def ping(_args, _ctx):
        return "ok"
    ctx.register_tool(create_pydantic_tool(
        ToolDefinition(name="watched_tool", description="watch", parameters={"type": "object", "properties": {}}),
        EmptyArgs,
        ping,
    ))
""",
            encoding="utf-8",
        )

        runtime = create_coding_runtime(MockProvider(responses=[{"text": "ok"}]))
        watcher = PluginWatcher(runtime, search_paths=[str(root)], debounce_ms=50)

        async def _run():
            await watcher.start()
            await asyncio.sleep(0.15)
            assert runtime.tools.get("watched_tool") is not None
            (root / "plugin.py").write_text(
                (root / "plugin.py").read_text(encoding="utf-8").replace("watched_tool", "watched_tool_v2"),
                encoding="utf-8",
            )
            await asyncio.sleep(0.35)
            assert runtime.tools.get("watched_tool_v2") is not None
            await watcher.stop()

        asyncio.run(_run())
