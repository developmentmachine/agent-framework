from __future__ import annotations

import typer

from agent_framework.core.domain import AgentRunRequest, AgentConfig
from agent_framework.core.tool_registry import DefaultToolRegistry
from agent_framework.providers.anthropic import AnthropicProvider
from agent_framework.providers.mock import MockProvider
from agent_framework.providers.openai import OpenAIProvider
from agent_framework.runtime import create_agent_runtime
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


def _runtime(workspace: str, provider: str, model: str):
    tools = DefaultToolRegistry()
    register_builtin_tools(tools)
    return create_agent_runtime(
        _provider(provider, model),
        config=AgentConfig(workspace_root=workspace, model=model, provider=provider),
        tools=tools,
    )


@app.command("run")
def run_command(
    message: str,
    workspace: str = typer.Option("."),
    provider: str = typer.Option("mock"),
    model: str = typer.Option("gpt-4o-mini"),
    session: str = typer.Option("default"),
    mode: str = typer.Option("agent"),
):
    import asyncio

    runtime = _runtime(workspace, provider, model)

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
def tools_command(workspace: str = typer.Option("."), provider: str = typer.Option("mock"), model: str = typer.Option("gpt-4o-mini")):
    runtime = _runtime(workspace, provider, model)
    for tool in runtime.tools.list():
        typer.echo(f"{tool.name}\t{tool.description}")


if __name__ == "__main__":
    app()
