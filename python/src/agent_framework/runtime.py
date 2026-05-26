from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent_framework.core.agent_loop import DefaultAgentLoop
from agent_framework.core.context_engine import WorkspaceContextEngine
from agent_framework.core.context_compactor import TruncateMiddleCompactor
from agent_framework.core.contracts import (
    AgentLoop,
    ContextEngine,
    EventBus,
    HookRunner,
    MemoryProvider,
    ModelProvider,
    PermissionPolicy,
    RunManager,
    SessionLane,
    SessionRouter,
    SessionStore,
    ToolRegistry,
)
from agent_framework.core.domain import AgentConfig, AgentRunRequest, DEFAULT_AGENT_CONFIG
from agent_framework.core.event_bus import InMemoryEventBus
from agent_framework.core.hook_runner import DefaultHookRunner
from agent_framework.core.in_memory_memory import InMemoryMemoryProvider
from agent_framework.core.in_memory_session import InMemorySessionStore
from agent_framework.core.permission_policy import DefaultPermissionPolicy, DEFAULT_CODING_POLICY_RULES
from agent_framework.core.run_manager import DefaultRunManager
from agent_framework.core.session_lane import DefaultSessionLane
from agent_framework.core.session_router import DefaultSessionRouter
from agent_framework.core.tool_registry import DefaultToolRegistry
from agent_framework.core.agent_loop import DefaultAgentLoop as Loop
from agent_framework.core.contracts import AgentLoopDeps
from agent_framework.core.telemetry import ConsoleSpanExporter, TelemetryPipeline, create_telemetry_pipeline


@dataclass
class AgentRuntime:
    config: AgentConfig
    provider: ModelProvider
    tools: ToolRegistry
    sessions: SessionStore
    memory: MemoryProvider
    hooks: HookRunner
    policy: PermissionPolicy
    context_engine: ContextEngine
    loop: AgentLoop
    lane: SessionLane
    runs: RunManager
    bus: EventBus
    router: SessionRouter
    telemetry: TelemetryPipeline | None = None


def create_agent_runtime(
    provider: ModelProvider,
    *,
    config: AgentConfig | None = None,
    tools: ToolRegistry | None = None,
    sessions: SessionStore | None = None,
    memory: MemoryProvider | None = None,
    hooks: HookRunner | None = None,
    policy: PermissionPolicy | None = None,
    on_ask_permission=None,
    compactor=None,
    telemetry: bool | dict[str, Any] | None = None,
) -> AgentRuntime:
    resolved_config = config or DEFAULT_AGENT_CONFIG
    resolved_tools = tools or DefaultToolRegistry()
    resolved_sessions = sessions or InMemorySessionStore()
    resolved_memory = memory or InMemoryMemoryProvider()
    resolved_hooks = hooks or DefaultHookRunner()
    resolved_policy = policy or DefaultPermissionPolicy(DEFAULT_CODING_POLICY_RULES)
    context_engine = WorkspaceContextEngine(resolved_config.workspace_root)
    resolved_compactor = compactor or TruncateMiddleCompactor()
    lane = DefaultSessionLane()
    runs = DefaultRunManager()
    bus = InMemoryEventBus()

    loop = DefaultAgentLoop(
        AgentLoopDeps(
            provider=provider,
            tools=resolved_tools,
            session_store=resolved_sessions,
            context_engine=context_engine,
            hooks=resolved_hooks,
            policy=resolved_policy,
            config=resolved_config,
            compactor=resolved_compactor,
            on_ask_permission=on_ask_permission,
        )
    )

    router = DefaultSessionRouter(lane, loop, runs, bus)

    telemetry_pipeline = None
    if telemetry:
        exporters = telemetry.get("exporters") if isinstance(telemetry, dict) else [ConsoleSpanExporter()]
        telemetry_pipeline = create_telemetry_pipeline(bus, exporters)

    return AgentRuntime(
        config=resolved_config,
        provider=provider,
        tools=resolved_tools,
        sessions=resolved_sessions,
        memory=resolved_memory,
        hooks=resolved_hooks,
        policy=resolved_policy,
        context_engine=context_engine,
        loop=loop,
        lane=lane,
        runs=runs,
        bus=bus,
        router=router,
        telemetry=telemetry_pipeline,
    )


async def run_agent(runtime: AgentRuntime, request: AgentRunRequest):
    events = []
    async for event in runtime.router.route(request):
        events.append(event)
    if runtime.telemetry:
        runtime.telemetry.flush()
    return events
