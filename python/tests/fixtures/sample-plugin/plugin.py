from agent_framework.core.domain import ToolDefinition
from agent_framework.core.tool_registry import create_pydantic_tool
from pydantic import BaseModel


class PingArgs(BaseModel):
    pass


async def register(ctx) -> None:
    async def ping(_args: PingArgs, _ctx):
        return "pong"

    ctx.register_tool(
        create_pydantic_tool(
            ToolDefinition(
                name="plugin_ping",
                description="Ping from sample plugin",
                parameters={"type": "object", "properties": {}},
            ),
            PingArgs,
            ping,
        )
    )
