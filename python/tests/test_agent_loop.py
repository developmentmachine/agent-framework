import asyncio

from pydantic import BaseModel

from agent_framework.core.domain import AgentRunRequest, ToolDefinition, ToolExecutionContext
from agent_framework.core.tool_registry import DefaultToolRegistry, create_pydantic_tool
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime


class EchoArgs(BaseModel):
    value: str


def test_agent_loop_executes_tool():
    registry = DefaultToolRegistry()
    registry.register(
        create_pydantic_tool(
            ToolDefinition(
                name="echo",
                description="Echo",
                parameters={"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]},
            ),
            EchoArgs,
            lambda args, ctx: args.value,
        )
    )

    runtime = create_agent_runtime(
        MockProvider(
            responses=[
                {"tool_calls": [{"name": "echo", "arguments": {"value": "hello"}}]},
                {"text": "done"},
            ]
        ),
        tools=registry,
    )

    async def _run():
        events = []
        async for event in runtime.router.route(
            AgentRunRequest(session_id="test", input={"role": "user", "content": "hi"})
        ):
            events.append(event)
        tool_events = [event for event in events if event.type == "tool"]
        assert tool_events
        assert any(event.name == "echo" for event in tool_events)

    asyncio.run(_run())
