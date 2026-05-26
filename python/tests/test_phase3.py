import asyncio

from agent_framework.core.best_of_n import BestOfNCandidate, BestOfNOrchestrator
from agent_framework.core.context_compactor import TruncateMiddleCompactor, estimate_tokens
from agent_framework.core.domain import AgentRunRequest, Message, ToolDefinition
from agent_framework.core.multi_agent_router import AgentRouteRule, MultiAgentRouter
from agent_framework.core.tool_registry import DefaultToolRegistry, create_pydantic_tool
from agent_framework.providers.failover import FailoverProvider
from agent_framework.providers.mock import MockProvider
from agent_framework.runtime import create_agent_runtime
from pydantic import BaseModel


class EchoArgs(BaseModel):
    value: str


def test_truncate_middle_compactor():
    compactor = TruncateMiddleCompactor()
    messages = [
        Message(role="system", content="system"),
        Message(role="user", content="first"),
        *[Message(role="user", content=f"msg-{index}") for index in range(20)],
        Message(role="assistant", content="tail"),
    ]

    async def _run():
        compacted = await compactor.compact(messages, token_budget=10)
        assert len(compacted) < len(messages)
        assert estimate_tokens(compacted[0]) >= 1

    asyncio.run(_run())


def test_failover_provider_uses_second_provider():
    failing = MockProvider(responses=[{"text": "should not reach"}])

    async def fail_stream(messages, tools):
        del messages, tools
        raise RuntimeError("provider down")
        yield  # pragma: no cover

    failing.stream = fail_stream  # type: ignore[method-assign]
    backup = MockProvider(responses=[{"text": "backup ok"}])
    provider = FailoverProvider([failing, backup])

    async def _run():
        chunks = []
        async for chunk in provider.stream([], []):
            chunks.append(chunk)
        assert any(chunk.type == "text_delta" and chunk.text_delta == "backup ok" for chunk in chunks)

    asyncio.run(_run())


def test_multi_agent_router_resolves_by_channel():
    main = create_agent_runtime(MockProvider(responses=[{"text": "main"}]))
    coding = create_agent_runtime(MockProvider(responses=[{"text": "coding"}]))
    router = MultiAgentRouter(
        [AgentRouteRule(agent_id="coding", runtime=coding, channel="github")],
        fallback=main,
    )
    assert router.resolve(session_id="s1", channel="github") is coding
    assert router.resolve(session_id="s1", channel="slack") is main


def test_best_of_n_picks_higher_score_candidate():
    good = create_agent_runtime(
        MockProvider(responses=[{"text": "good answer"}]),
    )
    bad = create_agent_runtime(
        MockProvider(responses=[{"tool_calls": [{"name": "missing", "arguments": {}}]}, {"text": "bad"}]),
    )

    async def _run():
        orchestrator = BestOfNOrchestrator()
        result = await orchestrator.run(
            AgentRunRequest(session_id="race", input={"role": "user", "content": "solve"}),
            [BestOfNCandidate(id="good", runtime=good), BestOfNCandidate(id="bad", runtime=bad)],
        )
        assert result["winner_id"] == "good"

    asyncio.run(_run())
