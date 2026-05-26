from __future__ import annotations

from agent_framework.core.context_compactor import TruncateMiddleCompactor
from agent_framework.core.llm_summarization_compactor import LlmSummarizationCompactor
from agent_framework.core.provider_summarizer import create_provider_summarizer
from agent_framework.core.sqlite_session import SqliteSessionStore
from agent_framework.core.tool_registry import DefaultToolRegistry
from agent_framework.runtime import create_agent_runtime


def create_coding_runtime(
    provider,
    *,
    config=None,
    tools=None,
    sessions=None,
    memory=None,
    hooks=None,
    policy=None,
    on_ask_permission=None,
    compactor=None,
    telemetry=None,
    sqlite_session_path: str | None = None,
    summarize_with_provider: bool = False,
):
    resolved_tools = tools or DefaultToolRegistry()
    resolved_sessions = SqliteSessionStore(sqlite_session_path) if sqlite_session_path else sessions
    resolved_compactor = compactor
    if resolved_compactor is None:
        if summarize_with_provider:
            resolved_compactor = LlmSummarizationCompactor(create_provider_summarizer(provider))
        else:
            resolved_compactor = TruncateMiddleCompactor()

    return create_agent_runtime(
        provider,
        config=config,
        tools=resolved_tools,
        sessions=resolved_sessions,
        memory=memory,
        hooks=hooks,
        policy=policy,
        on_ask_permission=on_ask_permission,
        compactor=resolved_compactor,
        telemetry=telemetry,
    )
