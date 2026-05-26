from __future__ import annotations

import asyncio
from pathlib import Path

from agent_framework.plugin_sdk.bootstrap import bootstrap_plugins


class PluginWatcher:
    def __init__(self, runtime, *, search_paths: list[str], debounce_ms: int = 300) -> None:
        self._runtime = runtime
        self._search_paths = search_paths
        self._debounce_ms = debounce_ms
        self._loaded_tools: list[str] = []
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        await self._reload()
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()

    async def _poll_loop(self) -> None:
        snapshots = {path: self._snapshot(path) for path in self._search_paths}
        while self._running:
            await asyncio.sleep(self._debounce_ms / 1000)
            for path in self._search_paths:
                current = self._snapshot(path)
                if snapshots.get(path) != current:
                    snapshots[path] = current
                    await self._reload()

    def _snapshot(self, path: str) -> float:
        root = Path(path)
        if not root.exists():
            return 0.0
        mtimes = [root.stat().st_mtime]
        for file in root.rglob("*"):
            if file.is_file():
                mtimes.append(file.stat().st_mtime)
        return max(mtimes) if mtimes else 0.0

    async def _reload(self) -> None:
        for tool_name in self._loaded_tools:
            if hasattr(self._runtime.tools, "unregister"):
                self._runtime.tools.unregister(tool_name)

        before = {tool.name for tool in self._runtime.tools.list()}
        await bootstrap_plugins(self._runtime, search_paths=self._search_paths)
        after = [tool.name for tool in self._runtime.tools.list()]
        self._loaded_tools = [name for name in after if name not in before]
