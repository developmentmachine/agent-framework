import asyncio

from agent_framework.core.domain import AgentRunRequest, ToolDefinition
from agent_framework.core.tool_registry import DefaultToolRegistry, create_pydantic_tool
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime
from pydantic import BaseModel


class EchoArgs(BaseModel):
    text: str


async def main() -> None:
    registry = DefaultToolRegistry()
    registry.register(
        create_pydantic_tool(
            ToolDefinition(
                name="echo",
                description="Echo input",
                parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
            ),
            EchoArgs,
            lambda args, ctx: args.text,
        )
    )
    runtime = create_agent_runtime(
        MockProvider(
            responses=[
                {"tool_calls": [{"name": "echo", "arguments": {"text": "hi"}}]},
                {"text": "done"},
            ]
        ),
        tools=registry,
    )
    async for event in runtime.router.route(
        AgentRunRequest(session_id="echo", input={"role": "user", "content": "echo hi"})
    ):
        print(event)


if __name__ == "__main__":
    asyncio.run(main())
