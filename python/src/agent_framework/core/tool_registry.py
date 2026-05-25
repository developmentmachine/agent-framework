from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ValidationError

from agent_framework.core.contracts import Tool, ToolExecutionContext, ToolRegistry
from agent_framework.core.domain import AgentError, AgentErrorCode, ToolCallRequest, ToolDefinition


class DefaultToolRegistry(ToolRegistry):
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.definition.name] = tool

    def list(self, toolset: list[str] | None = None) -> list[ToolDefinition]:
        tools = [tool.definition for tool in self._tools.values()]
        if toolset:
            allowed = set(toolset)
            tools = [tool for tool in tools if tool.name in allowed]
        return sorted(tools, key=lambda item: item.name)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    async def execute(self, ctx: ToolExecutionContext, call: ToolCallRequest) -> tuple[Any, str | None]:
        tool = self._tools.get(call.name)
        if tool is None:
            raise AgentError(f"Tool not found: {call.name}", AgentErrorCode.TOOL_NOT_FOUND)
        try:
            output = await tool.execute(ctx, call.arguments)
            return output, None
        except Exception as exc:  # noqa: BLE001
            return None, str(exc)


def create_pydantic_tool(
    tool_definition: ToolDefinition,
    schema: type[BaseModel],
    execute,
) -> Tool:
    class PydanticTool:
        definition = tool_definition

        async def execute(self, ctx: ToolExecutionContext, args: dict[str, Any]) -> Any:
             
            try:
                parsed = schema.model_validate(args)
            except ValidationError as exc:
                raise AgentError(str(exc), AgentErrorCode.VALIDATION_ERROR) from exc
            return await execute(parsed, ctx)

    return PydanticTool()
