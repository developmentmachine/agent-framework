from __future__ import annotations

import asyncio
from pathlib import Path

import typer

from agent_framework.core.coding_runtime import create_coding_runtime
from agent_framework.core.cron_agent_surface import CronAgentSurface
from agent_framework.core.cron_scheduler import CronJob
from agent_framework.core.domain import AgentConfig, AgentRunRequest
from agent_framework.core.tool_registry import DefaultToolRegistry
from agent_framework.providers.anthropic import AnthropicProvider
from agent_framework.providers.mock import MockProvider
from agent_framework.providers.openai import OpenAIProvider
from agent_framework.tools.builtin import register_builtin_tools

app = typer.Typer(help="Universal agent framework CLI")


def _provider(name: str, model: str):
    if name == "openai":
        import os

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise typer.BadParameter("OPENAI_API_KEY is required")
        return OpenAIProvider(api_key=api_key, model=model)
    if name == "anthropic":
        import os

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise typer.BadParameter("ANTHROPIC_API_KEY is required")
        return AnthropicProvider(api_key=api_key, model=model)
    return MockProvider(
        responses=[
            {
                "text": "Mock agent response. Set OPENAI_API_KEY or ANTHROPIC_API_KEY for live models."
            }
        ]
    )


def _runtime(workspace: str, provider: str, model: str, data_dir: str = ".agent-data"):
    tools = DefaultToolRegistry()
    register_builtin_tools(tools)
    data_path = Path(data_dir)
    return create_coding_runtime(
        _provider(provider, model),
        config=AgentConfig(workspace_root=workspace, model=model, provider=provider),
        tools=tools,
        sqlite_session_path=str(data_path / "sessions.db"),
        sqlite_memory_path=str(data_path / "memory.db"),
    )


@app.command("run")
def run_command(
    message: str,
    workspace: str = typer.Option("."),
    provider: str = typer.Option("mock"),
    model: str = typer.Option("gpt-4o-mini"),
    session: str = typer.Option("default"),
    mode: str = typer.Option("agent"),
    data_dir: str = typer.Option(".agent-data", "--data-dir"),
):
    runtime = _runtime(workspace, provider, model, data_dir)

    async def _main() -> None:
        async for event in runtime.router.route(
            AgentRunRequest(session_id=session, input={"role": "user", "content": message}, mode=mode)
        ):
            if event.type == "assistant":
                typer.echo(event.delta, nl=False)
            elif event.type == "tool":
                typer.echo(f"\n[tool:{event.name}] {event.status}")
        typer.echo("")

    asyncio.run(_main())


@app.command("tools")
def tools_command(
    workspace: str = typer.Option("."),
    provider: str = typer.Option("mock"),
    model: str = typer.Option("gpt-4o-mini"),
    data_dir: str = typer.Option(".agent-data", "--data-dir"),
):
    runtime = _runtime(workspace, provider, model, data_dir)
    for tool in runtime.tools.list():
        typer.echo(f"{tool.name}\t{tool.description}")


@app.command("gateway")
def gateway_command(
    host: str = typer.Option("127.0.0.1"),
    port: int = typer.Option(18789),
    workspace: str = typer.Option("."),
    provider: str = typer.Option("mock"),
    model: str = typer.Option("gpt-4o-mini"),
    plugin_path: str = typer.Option("", "--plugin-path"),
    data_dir: str = typer.Option(".agent-data", "--data-dir"),
):
    from agent_framework.gateway import AgentGateway
    from agent_framework.plugin_sdk.bootstrap import bootstrap_plugins
    from agent_framework.plugin_sdk.plugin_watcher import PluginWatcher

    runtime = _runtime(workspace, provider, model, data_dir)

    async def _main() -> None:
        if plugin_path:
            await bootstrap_plugins(runtime, search_paths=[plugin_path])
            watcher = PluginWatcher(runtime, search_paths=[plugin_path])
            await watcher.start()
        gateway = AgentGateway(runtime, host=host, port=port)
        await gateway.start()
        typer.echo(f"Gateway listening on ws://{host}:{port}")
        await asyncio.Event().wait()

    asyncio.run(_main())


@app.command("cron")
def cron_command(
    interval: int = typer.Option(..., "--interval"),
    prompt: str = typer.Option(..., "--prompt"),
    session: str = typer.Option("default"),
    workspace: str = typer.Option("."),
    provider: str = typer.Option("mock"),
    model: str = typer.Option("gpt-4o-mini"),
    data_dir: str = typer.Option(".agent-data", "--data-dir"),
):
    runtime = _runtime(workspace, provider, model, data_dir)
    surface = CronAgentSurface(runtime)
    surface.register(CronJob(id="cli-cron", interval_ms=interval, prompt=prompt, session_id=session))

    async def _main() -> None:
        typer.echo(f"Cron job running every {interval}ms (Ctrl+C to stop)")
        await asyncio.Event().wait()

    asyncio.run(_main())


if __name__ == "__main__":
    app()
