from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import AsyncIterator
from uuid import uuid4

from agent_framework.core.contracts import (
    AgentLoopDeps,
    AssistantEvent,
    LifecycleEvent,
    StreamEvent,
    ToolEvent,
    UsageEvent,
)
from agent_framework.core.domain import (
    AgentRunRequest,
    Message,
    TextContent,
    ToolCallContent,
    ToolCallRequest,
    ToolExecutionContext,
    ToolResultContent,
)


@dataclass
class _ToolExecutionResult:
    events: list[StreamEvent]
    message: Message


class DefaultAgentLoop:
    def __init__(self, deps: AgentLoopDeps) -> None:
        self._deps = deps

    async def run(self, request: AgentRunRequest) -> AsyncIterator[StreamEvent]:
        run_id = str(uuid4())
        hook_context = {"session_id": request.session_id, "run_id": run_id}

        yield LifecycleEvent(phase="start", run_id=run_id)
        await self._deps.hooks.emit({"type": "onRunStart", "context": hook_context})

        try:
            await self._deps.session_store.append_messages(
                request.session_id,
                [Message(role="user", content=request.input["content"])],
            )
            session = await self._deps.session_store.get(request.session_id)
            history = list(
                session.messages
                if session
                else [Message(role="user", content=request.input["content"])]
            )

            for _ in range(self._deps.config.max_turns):
                if self._deps.compactor:
                    history = await self._deps.compactor.compact(history, self._deps.config.token_budget)
                _, messages = await self._deps.context_engine.build(
                    request.session_id,
                    request.mode,
                    history,
                )
                pending_calls: list[ToolCallRequest] = []
                assistant_text = ""

                async for chunk in self._deps.provider.stream(messages, self._deps.tools.list()):
                    if chunk.type == "text_delta" and chunk.text_delta:
                        assistant_text += chunk.text_delta
                        yield AssistantEvent(delta=chunk.text_delta)
                    if chunk.type == "tool_call" and chunk.tool_call:
                        pending_calls.append(chunk.tool_call)
                    if chunk.type == "usage" and chunk.usage:
                        yield UsageEvent(tokens=chunk.usage)

                assistant_message = _build_assistant_message(assistant_text, pending_calls)
                history.append(assistant_message)
                await self._deps.session_store.append_messages(request.session_id, [assistant_message])

                if not pending_calls:
                    await self._deps.hooks.emit({
                        "type": "onRunEnd",
                        "context": hook_context,
                        "reason": {"kind": "completed"},
                    })
                    yield LifecycleEvent(phase="end", run_id=run_id)
                    return

                tool_messages: list[Message] = []
                async for event in self._execute_tool_calls(request, run_id, pending_calls, hook_context):
                    if isinstance(event, _ToolExecutionResult):
                        tool_messages.append(event.message)
                        history.append(event.message)
                    else:
                        yield event
                await self._deps.session_store.append_messages(request.session_id, tool_messages)

            await self._deps.hooks.emit({
                "type": "onRunEnd",
                "context": hook_context,
                "reason": {"kind": "max_turns"},
            })
            yield LifecycleEvent(phase="end", run_id=run_id)
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            await self._deps.hooks.emit({
                "type": "onRunEnd",
                "context": hook_context,
                "reason": {"kind": "error", "message": message},
            })
            yield LifecycleEvent(phase="error", run_id=run_id, error=message)

    async def _execute_tool_calls(self, request, run_id, calls, hook_context):
        index = 0
        while index < len(calls):
            call = calls[index]
            concurrency = self._tool_concurrency(call.name)

            if concurrency == "serial":
                result = await self._execute_tool_call(request, run_id, call, hook_context)
                for event in result.events:
                    yield event
                yield result
                index += 1
                continue

            batch = [call]
            index += 1
            while index < len(calls) and self._tool_concurrency(calls[index].name) == "parallel":
                batch.append(calls[index])
                index += 1

            results = await asyncio.gather(
                *[self._execute_tool_call(request, run_id, item, hook_context) for item in batch]
            )
            for result in results:
                for event in result.events:
                    yield event
                yield result

    def _tool_concurrency(self, tool_name: str) -> str:
        tool = self._deps.tools.get(tool_name)
        return tool.definition.concurrency if tool else "parallel"

    async def _execute_tool_call(self, request, run_id, call, hook_context) -> _ToolExecutionResult:
        events: list[StreamEvent] = [ToolEvent(call_id=call.id, name=call.name, status="start")]
        await self._deps.hooks.emit({
            "type": "preToolUse",
            "context": hook_context,
            "tool_name": call.name,
            "arguments": call.arguments,
        })

        decision = await self._deps.policy.check(call.name, call.arguments, request.session_id)
        if decision == "deny":
            error = f"Permission denied for tool {call.name}"
            events.append(ToolEvent(call_id=call.id, name=call.name, status="error", output=error))
            return _ToolExecutionResult(events=events, message=_tool_result_message(call.id, error, True))

        if decision == "ask":
            approved = False
            if self._deps.on_ask_permission:
                approved = await self._deps.on_ask_permission(
                    call.name, call.arguments, request.session_id
                )
            if not approved:
                error = f"User denied tool {call.name}"
                events.append(ToolEvent(call_id=call.id, name=call.name, status="error", output=error))
                return _ToolExecutionResult(events=events, message=_tool_result_message(call.id, error, True))

        ctx = ToolExecutionContext(
            session_id=request.session_id,
            run_id=run_id,
            workspace_root=self._deps.config.workspace_root,
        )
        output, error = await self._deps.tools.execute(ctx, call)
        content = error or (output if isinstance(output, str) else json.dumps(output, indent=2))
        events.append(
            ToolEvent(
                call_id=call.id,
                name=call.name,
                status="error" if error else "end",
                output=content,
            )
        )
        return _ToolExecutionResult(
            events=events,
            message=_tool_result_message(call.id, content, bool(error)),
        )


def _build_assistant_message(text: str, calls: list[ToolCallRequest]) -> Message:
    if not calls:
        return Message(role="assistant", content=text)
    content = []
    if text:
        content.append(TextContent(text=text))
    for call in calls:
        content.append(ToolCallContent(id=call.id, name=call.name, arguments=call.arguments))
    return Message(role="assistant", content=content)


def _tool_result_message(tool_call_id: str, content: str, is_error: bool) -> Message:
    return Message(
        role="tool",
        content=[ToolResultContent(tool_call_id=tool_call_id, content=content, is_error=is_error)],
    )
