import asyncio
from pathlib import Path

from agent_framework.core.domain import AgentRunRequest, ToolCallRequest, ToolExecutionContext
from agent_framework.core.tool_registry import DefaultToolRegistry
from agent_framework.plugin_sdk.mcp_stdio import MCPClient, register_mcp_tools
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime
from agent_framework.tools.builtin import BuiltinToolsOptions, create_builtin_tools


class RecordingSandbox:
    def __init__(self) -> None:
        self.commands: list[str] = []

    async def execute(self, command: str, *, cwd: str, timeout_ms: int):
        del cwd, timeout_ms
        self.commands.append(command)

        class Result:
            stdout = f"ran:{command}"
            stderr = ""
            exit_code = 0

        return Result()


def test_shell_tool_uses_sandbox_backend():
    sandbox = RecordingSandbox()
    registry = DefaultToolRegistry()
    for tool in create_builtin_tools(BuiltinToolsOptions(sandbox=sandbox)):
        registry.register(tool)

    async def _run():
        output, error = await registry.execute(
            ToolExecutionContext(session_id="s1", run_id="r1", workspace_root="."),
            ToolCallRequest(id="call-1", name="shell", arguments={"command": "echo hello"}),
        )
        assert error is None
        assert sandbox.commands == ["echo hello"]
        assert output == "ran:echo hello"

    asyncio.run(_run())


def test_mcp_stdio_client_lists_and_calls_tools():
    fixture = Path(__file__).parent / "fixtures" / "mock_mcp_server.py"

    async def _run():
        client = MCPClient("python3", [str(fixture)])
        registry = DefaultToolRegistry()
        await register_mcp_tools(client, registry)
        assert any(tool.name == "echo" for tool in registry.list())

        output, error = await registry.execute(
            ToolExecutionContext(session_id="s1", run_id="r1", workspace_root="."),
            ToolCallRequest(id="call-2", name="echo", arguments={"text": "mcp-ok"}),
        )
        assert error is None
        assert output == "mcp-ok"
        await client.close()

    asyncio.run(_run())


def test_telemetry_pipeline_collects_run_spans():
    exported: list[str] = []

    class Exporter:
        def export(self, spans):
            exported.extend(span.name for span in spans)

    async def _run():
        runtime = create_agent_runtime(
            MockProvider(responses=[{"text": "done"}]),
            telemetry={"exporters": [Exporter()]},
        )
        async for _event in runtime.router.route(
            AgentRunRequest(session_id="telemetry", input={"role": "user", "content": "hello"}),
        ):
            pass
        runtime.telemetry.flush()
        assert any(name.startswith("run:") for name in exported)

    asyncio.run(_run())
