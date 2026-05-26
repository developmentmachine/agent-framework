from __future__ import annotations

import asyncio

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, TypedDict, Union

MessageRole = Literal["system", "user", "assistant", "tool"]
AgentMode = Literal["agent", "plan", "ask"]
RunStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
ToolConcurrency = Literal["parallel", "serial"]
PermissionDecision = Literal["allow", "deny", "ask"]


class TokenUsage(TypedDict):
    input: int
    output: int
    total: int


class UserMessage(TypedDict):
    role: Literal["user"]
    content: str


@dataclass
class TextContent:
    type: Literal["text"] = "text"
    text: str = ""


@dataclass
class ToolCallContent:
    type: Literal["tool_call"] = "tool_call"
    id: str = ""
    name: str = ""
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResultContent:
    type: Literal["tool_result"] = "tool_result"
    tool_call_id: str = ""
    content: str = ""
    is_error: bool = False


MessageContent = Union[TextContent, ToolCallContent, ToolResultContent]


@dataclass
class Message:
    role: MessageRole
    content: str | list[MessageContent]


@dataclass
class AgentRunRequest:
    session_id: str
    input: UserMessage
    mode: AgentMode = "agent"
    cancel_event: asyncio.Event | None = None


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    concurrency: ToolConcurrency = "parallel"


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ModelChunk:
    type: Literal["text_delta", "tool_call", "usage", "done"]
    text_delta: str | None = None
    tool_call: ToolCallRequest | None = None
    usage: TokenUsage | None = None


@dataclass
class ToolExecutionContext:
    session_id: str
    run_id: str
    workspace_root: str


@dataclass
class AgentConfig:
    workspace_root: str = "."
    max_turns: int = 25
    model: str = "gpt-4o-mini"
    provider: str = "openai"
    tool_timeout_ms: int = 60_000
    run_timeout_ms: int = 600_000
    token_budget: int = 100_000


DEFAULT_AGENT_CONFIG = AgentConfig()


class AgentErrorCode(str, Enum):
    CANCELLED = "CANCELLED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"
    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    MAX_TURNS = "MAX_TURNS"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    TIMEOUT = "TIMEOUT"


class AgentError(Exception):
    def __init__(self, message: str, code: AgentErrorCode, recoverable: bool = False):
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


TerminalReason = dict[str, str]
