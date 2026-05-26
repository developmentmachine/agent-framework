import asyncio
import json
import tempfile
from pathlib import Path

import httpx
import pytest

from agent_framework.core.coding_runtime import create_coding_runtime
from agent_framework.core.in_memory_memory import InMemoryMemoryProvider
from agent_framework.core.memory_context_engine import MemoryAugmentedContextEngine
from agent_framework.core.context_engine import WorkspaceContextEngine
from agent_framework.core.domain import AgentRunRequest, Message
from agent_framework.core.webhook_surface import WebhookSurface, WebhookSurfaceOptions
from agent_framework.gateway import AgentGateway
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime

pytest.importorskip("websockets")


def test_memory_augmented_context_engine_injects_memory():
    memory = InMemoryMemoryProvider()

    async def _run():
        await memory.set("stack", "Python agent framework", scope="persistent")
        engine = MemoryAugmentedContextEngine(WorkspaceContextEngine("."), memory)
        system_prompt, _messages = await engine.build(
            "memory-session",
            "agent",
            [Message(role="user", content="What stack do we use?")],
        )
        assert "## Memory" in system_prompt
        assert "Python agent framework" in system_prompt

    asyncio.run(_run())


def test_create_agent_runtime_wires_memory_context():
    memory = InMemoryMemoryProvider()

    async def _run():
        await memory.set("note", "memory wired into runtime", scope="persistent")
        runtime = create_agent_runtime(MockProvider(responses=[{"text": "ok"}]), memory=memory)
        system_prompt, _messages = await runtime.context_engine.build(
            "s1",
            "agent",
            [Message(role="user", content="memory wired")],
        )
        assert "memory wired into runtime" in system_prompt

    asyncio.run(_run())


def test_webhook_surface_runs_agent_requests():
    runtime = create_coding_runtime(MockProvider(responses=[{"text": "webhook ok"}]))

    async def _run():
        surface = WebhookSurface(WebhookSurfaceOptions(runtime=runtime, host="127.0.0.1", port=0))
        port = await surface.start()
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"http://127.0.0.1:{port}/webhook",
                json={"sessionId": "webhook-session", "message": "hello webhook"},
            )
        payload = response.json()
        assert payload["ok"] is True
        assert any(event.get("type") == "assistant" for event in payload["events"])
        await surface.stop()

    asyncio.run(_run())


def test_python_gateway_agent_streaming():
    import websockets

    runtime = create_coding_runtime(MockProvider(responses=[{"text": "stream ok"}]))
    gateway = AgentGateway(runtime, port=0)

    async def _run():
        port = await gateway.start()
        pending: asyncio.Queue[dict] = asyncio.Queue()

        async def collect_messages(ws):
            async for raw in ws:
                await pending.put(json.loads(raw))

        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            collector = asyncio.create_task(collect_messages(ws))
            await ws.send(json.dumps({"type": "req", "id": "1", "method": "connect", "params": {}}))
            await pending.get()

            await ws.send(
                json.dumps(
                    {
                        "type": "req",
                        "id": "agent-1",
                        "method": "agent",
                        "params": {"sessionId": "stream", "message": "hello stream"},
                    }
                )
            )

            events = []
            response = None
            while response is None:
                frame = await asyncio.wait_for(pending.get(), timeout=5)
                if frame.get("type") == "event":
                    events.append(frame.get("payload"))
                if frame.get("type") == "res" and frame.get("id") == "agent-1":
                    response = frame

            collector.cancel()
            assert len(events) > 0
            assert response["ok"] is True

        await gateway.stop()

    asyncio.run(_run())


def test_python_gateway_agent_cancel():
    import websockets

    runtime = create_coding_runtime(MockProvider(responses=[{"text": "ok"}]))
    gateway = AgentGateway(runtime, port=0)

    async def _run():
        port = await gateway.start()
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps({"type": "req", "id": "1", "method": "connect", "params": {}}))
            await ws.recv()

            await ws.send(
                json.dumps(
                    {
                        "type": "req",
                        "id": "cancel-1",
                        "method": "agent.cancel",
                        "params": {"runId": "missing-run"},
                    }
                )
            )
            cancel = json.loads(await ws.recv())
            assert cancel["ok"] is True
            assert cancel["payload"]["cancelled"] is False

        await gateway.stop()

    asyncio.run(_run())
