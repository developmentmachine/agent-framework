from __future__ import annotations


async def bootstrap_plugins(runtime, *, search_paths: list[str]) -> None:
    from agent_framework.plugin_sdk import PluginLoader

    loader = PluginLoader(search_paths)
    await loader.apply(runtime.tools, runtime.hooks, [runtime.provider])
