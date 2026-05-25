from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, Protocol

from agent_framework.core.domain import (
    AgentConfig,
    AgentMode,
    AgentRunRequest,
    Message,
    ModelChunk,
    PermissionDecision,
    RunStatus,
    TerminalReason,
    TokenUsage,
    ToolCallRequest,
    ToolDefinition,
    ToolExecutionContext,
    UserMessage,
)


@dataclass
class LifecycleEvent:
    type: str = "lifecycle"
    phase: str = "start"
    run_id: str = ""
    error: str | None = None


@dataclass
class AssistantEvent:
    type: str = "assistant"
    delta: str = ""


@dataclass
class ToolEvent:
    type: str = "tool"
    call_id: str = ""
    name: str = ""
    status: str = "start"
    output: Any | None = None


@dataclass
class UsageEvent:
    type: str = "usage"
    tokens: TokenUsage | None = None


StreamEvent = LifecycleEvent | AssistantEvent | ToolEvent | UsageEvent


class ModelProvider(Protocol):
    id: str

    def stream(self, messages: list[Message], tools: list[ToolDefinition]) -> AsyncIterator[ModelChunk]:
        ...


class Tool(Protocol):
    definition: ToolDefinition

    async def execute(self, ctx: ToolExecutionContext, args: dict[str, Any]) -> Any:
        ...


@dataclass
class SessionRecord:
    id: str
    messages: list[Message]
    created_at: str
    updated_at: str
    metadata: dict[str, Any] | None = None


class SessionStore(Protocol):
    async def get(self, session_id: str) -> SessionRecord | None:
        ...

    async def save(self, session: SessionRecord) -> None:
        ...

    async def append_messages(self, session_id: str, messages: list[Message]) -> None:
        ...


class MemoryProvider(Protocol):
    async def get(self, key: str, scope: str = "working") -> str | None:
        ...

    async def set(self, key: str, value: str, scope: str = "working") -> None:
        ...

    async def search(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        ...


class ContextEngine(Protocol):
    async def build(self, session_id: str, mode: AgentMode, history: list[Message]) -> tuple[str, list[Message]]:
        ...


class PermissionPolicy(Protocol):
    async def check(self, tool_name: str, arguments: dict[str, Any], session_id: str) -> PermissionDecision:
        ...


@dataclass
class HookContext:
    session_id: str
    run_id: str


class HookHandler(Protocol):
    id: str

    async def handle(self, event: dict[str, Any]) -> None:
        ...


class HookRunner(Protocol):
    def register(self, handler: HookHandler) -> None:
        ...

    async def emit(self, event: dict[str, Any]) -> None:
        ...


class ToolRegistry(Protocol):
    def register(self, tool: Tool) -> None:
        ...

    def list(self, toolset: list[str] | None = None) -> list[ToolDefinition]:
        ...

    def get(self, name: str) -> Tool | None:
        ...

    async def execute(self, ctx: ToolExecutionContext, call: ToolCallRequest) -> tuple[Any, str | None]:
        ...


class EventBus(Protocol):
    def subscribe(self, listener) -> callable:
        ...

    def publish(self, event: StreamEvent) -> None:
        ...


class SessionLane(Protocol):
    async def enqueue(self, session_id: str, task):
        ...


@dataclass
class RunRecord:
    run_id: str
    session_id: str
    status: RunStatus
    started_at: str
    ended_at: str | None = None
    error: str | None = None


class RunManager(Protocol):
    def create(self, session_id: str) -> RunRecord:
        ...

    def update(self, run_id: str, patch: dict[str, Any]) -> None:
        ...

    def get(self, run_id: str) -> RunRecord | None:
        ...


class AgentLoop(Protocol):
    def run(self, request: AgentRunRequest) -> AsyncIterator[StreamEvent]:
        ...


class SessionRouter(Protocol):
    def route(self, request: AgentRunRequest) -> AsyncIterator[StreamEvent]:
        ...


@dataclass
class AgentLoopDeps:
    provider: ModelProvider
    tools: ToolRegistry
    session_store: SessionStore
    context_engine: ContextEngine
    hooks: HookRunner
    policy: PermissionPolicy
    config: AgentConfig
    on_ask_permission: Any | None = None
