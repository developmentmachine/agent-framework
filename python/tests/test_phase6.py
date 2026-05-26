import asyncio
import json
import tempfile
from pathlib import Path

from agent_framework.core.coding_runtime import create_coding_runtime
from agent_framework.core.cron_agent_surface import CronAgentSurface
from agent_framework.core.cron_scheduler import CronJob
from agent_framework.core.domain import Message
from agent_framework.core.llm_summarization_compactor import LlmSummarizationCompactor
from agent_framework.core.provider_summarizer import create_provider_summarizer
from agent_framework.gateway import AgentGateway
from agent_framework.plugin_sdk.bootstrap import bootstrap_plugins
from agent_framework.providers.mock import MockProvider


def test_create_coding_runtime_uses_sqlite_sessions():
    with tempfile.TemporaryDirectory() as tmp:
        runtime = create_coding_runtime(
            MockProvider(responses=[{"text": "ok"}]),
            sqlite_session_path=str(Path(tmp) / "sessions.db"),
        )

        async def _run():
            await runtime.sessions.append_messages("sqlite-session", [Message(role="user", content="persist me")])
            session = await runtime.sessions.get("sqlite-session")
            assert session is not None
            assert session.messages[0].content == "persist me"
            runtime.sessions.close()

        asyncio.run(_run())


def test_create_provider_summarizer():
    provider = MockProvider(responses=[{"text": "condensed summary"}])
    summarize = create_provider_summarizer(provider)
    compactor = LlmSummarizationCompactor(summarize, keep_recent=1)

    async def _run():
        compacted = await compactor.compact(
            [
                Message(role="user", content="first"),
                Message(role="user", content="second"),
                Message(role="assistant", content="third"),
            ],
            token_budget=2,
        )
        assert any("condensed summary" in str(message.content) for message in compacted)

    asyncio.run(_run())


def test_cron_agent_surface_runs_jobs():
    runtime = create_coding_runtime(MockProvider(responses=[{"text": "cron ok"}]))
    surface = CronAgentSurface(runtime)

    async def _run():
        surface.register(CronJob(id="tick", interval_ms=50, prompt="cron hello", session_id="cron-session"))
        await asyncio.sleep(0.12)
        surface.stop_all()
        session = await runtime.sessions.get("cron-session")
        assert session is not None
        assert len(session.messages) > 0

    asyncio.run(_run())


def test_bootstrap_plugins_loads_sample_plugin():
    runtime = create_coding_runtime(MockProvider(responses=[{"text": "ok"}]))
    fixture = Path(__file__).parent / "fixtures" / "sample-plugin"

    async def _run():
        await bootstrap_plugins(runtime, search_paths=[str(fixture)])
        assert runtime.tools.get("plugin_ping") is not None

    asyncio.run(_run())


def test_python_gateway_tools_list():
    import websockets

    runtime = create_coding_runtime(MockProvider(responses=[{"text": "gateway ok"}]))
    gateway = AgentGateway(runtime, port=0)

    async def _run():
        port = await gateway.start()
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps({"type": "req", "id": "1", "method": "connect", "params": {}}))
            connect = json.loads(await ws.recv())
            assert connect["ok"] is True

            await ws.send(json.dumps({"type": "req", "id": "2", "method": "tools.list", "params": {}}))
            tools = json.loads(await ws.recv())
            assert "tools" in tools["payload"]

        await gateway.stop()

    asyncio.run(_run())
