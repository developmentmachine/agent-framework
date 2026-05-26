import asyncio
import json
import tempfile
from pathlib import Path

from agent_framework.core.agent_loop import DefaultAgentLoop
from agent_framework.core.contracts import AgentLoopDeps
from agent_framework.core.domain import AgentRunRequest, Message, ToolCallRequest, ToolDefinition
from agent_framework.core.in_memory_session import InMemorySessionStore
from agent_framework.core.llm_summarization_compactor import LlmSummarizationCompactor
from agent_framework.core.sqlite_session import SqliteSessionStore
from agent_framework.core.sub_agent_runner import InProcessSubAgentRunner
from agent_framework.core.tool_registry import DefaultToolRegistry, create_pydantic_tool
from agent_framework.core.webhook_surface import WebhookSurface, WebhookSurfaceOptions
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime
from pydantic import BaseModel


def test_sqlite_session_store_search():
    with tempfile.TemporaryDirectory() as tmp:
        store = SqliteSessionStore(str(Path(tmp) / "sessions.db"))

        async def _run():
            await store.append_messages("alpha", [Message(role="user", content="find the needle in haystack")])
            await store.append_messages("beta", [Message(role="user", content="nothing here")])
            hits = await store.search("needle")
            assert any(hit.session_id == "alpha" for hit in hits)
            assert all(hit.session_id != "beta" for hit in hits)
            store.close()

        asyncio.run(_run())


def test_llm_summarization_compactor():
    async def summarize(messages):
        return f"summary:{len(messages)}"

    compactor = LlmSummarizationCompactor(summarize, keep_recent=2)
    messages = [
        Message(role="system", content="system"),
        Message(role="user", content="first"),
        *[Message(role="user", content=f"msg-{index}") for index in range(8)],
        Message(role="assistant", content="tail"),
    ]

    async def _run():
        compacted = await compactor.compact(messages, token_budget=10)
        assert any("summary:" in str(message.content) for message in compacted)
        assert len(compacted) < len(messages)

    asyncio.run(_run())


def test_parallel_tool_execution_is_concurrent():
    class SlowArgs(BaseModel):
        label: str

    registry = DefaultToolRegistry()

    async def slow_tool(args: SlowArgs, ctx):
        del ctx
        await asyncio.sleep(0.1)
        return args.label

    registry.register(
        create_pydantic_tool(
            ToolDefinition(
                name="slow",
                description="Slow parallel tool",
                parameters={"type": "object", "properties": {"label": {"type": "string"}}, "required": ["label"]},
                concurrency="parallel",
            ),
            SlowArgs,
            slow_tool,
        )
    )

    provider = MockProvider(
        responses=[
            {
                "tool_calls": [
                    {"name": "slow", "arguments": {"label": "a"}},
                    {"name": "slow", "arguments": {"label": "b"}},
                ]
            },
            {"text": "done"},
        ]
    )

    runtime = create_agent_runtime(provider, tools=registry)

    async def _run():
        started = asyncio.get_running_loop().time()
        async for _event in runtime.router.route(
            AgentRunRequest(session_id="parallel", input={"role": "user", "content": "run parallel tools"}),
        ):
            pass
        elapsed = asyncio.get_running_loop().time() - started
        assert elapsed < 0.18

    asyncio.run(_run())


def test_sub_agent_runner_spawn_and_wait():
    runtime = create_agent_runtime(MockProvider(responses=[{"text": "subagent done"}]))
    runner = InProcessSubAgentRunner(runtime)

    async def _run():
        handle = await runner.spawn(
            {
                "prompt": "do work",
                "session_id": "parent:sub",
                "parent_run_id": "parent-run",
            }
        )
        reason = await runner.wait(handle, timeout_ms=5_000)
        assert reason["kind"] == "completed"

    asyncio.run(_run())


def test_python_webhook_surface_handles_post():
    runtime = create_agent_runtime(MockProvider(responses=[{"text": "webhook ok"}]))
    surface = WebhookSurface(WebhookSurfaceOptions(runtime=runtime, port=0))

    async def _run():
        await surface.start()
        assert surface._server is not None
        port = surface._server.sockets[0].getsockname()[1]
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        payload = json.dumps({"sessionId": "hook", "message": "hello webhook"})
        request = (
            f"POST /webhook HTTP/1.1\r\n"
            "Host: 127.0.0.1\r\n"
            f"Content-Length: {len(payload)}\r\n"
            "Content-Type: application/json\r\n\r\n"
            f"{payload}"
        )
        writer.write(request.encode("utf-8"))
        await writer.drain()
        response = await reader.read()
        writer.close()
        await writer.wait_closed()
        await surface.stop()
        assert b'"ok": true' in response
        assert b"webhook ok" in response or b"assistant" in response

    asyncio.run(_run())
