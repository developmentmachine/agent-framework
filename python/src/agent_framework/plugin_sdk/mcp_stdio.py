from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any


@dataclass
class MCPToolDescriptor:
    name: str
    description: str
    input_schema: dict[str, Any]


class MCPClient:
    def __init__(self, command: str, args: list[str] | None = None, env: dict[str, str] | None = None) -> None:
        self.command = command
        self.args = args or []
        self.env = env
        self._process: asyncio.subprocess.Process | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self._connected = False

    async def connect(self) -> None:
        if self._connected:
            return

        self._process = await asyncio.create_subprocess_exec(
            self.command,
            *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self.env,
        )
        self._reader_task = asyncio.create_task(self._read_stdout())
        await self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "agent-framework", "version": "0.1.0"},
            },
        )
        await self._notify("notifications/initialized", {})
        self._connected = True

    async def list_tools(self) -> list[MCPToolDescriptor]:
        await self.connect()
        result = await self._request("tools/list", {})
        tools = result.get("tools", []) if isinstance(result, dict) else []
        return [
            MCPToolDescriptor(
                name=str(tool["name"]),
                description=str(tool.get("description", "")),
                input_schema=tool.get("inputSchema", {"type": "object", "properties": {}}),
            )
            for tool in tools
        ]

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        await self.connect()
        result = await self._request("tools/call", {"name": name, "arguments": args})
        if not isinstance(result, dict):
            return result

        content = result.get("content", [])
        text = "\n".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text" and part.get("text")
        )
        if result.get("isError"):
            raise RuntimeError(text or f"MCP tool {name} failed")
        return text or result

    async def close(self) -> None:
        if self._process and self._process.returncode is None:
            self._process.kill()
            await self._process.wait()
        if self._reader_task:
            self._reader_task.cancel()
        self._connected = False

    async def _read_stdout(self) -> None:
        assert self._process and self._process.stdout
        while True:
            line = await self._process.stdout.readline()
            if not line:
                break
            payload = json.loads(line.decode("utf-8").strip())
            request_id = payload.get("id")
            if request_id is None:
                continue
            future = self._pending.pop(int(request_id), None)
            if future is None:
                continue
            if "error" in payload:
                future.set_exception(RuntimeError(payload["error"].get("message", "MCP error")))
            else:
                future.set_result(payload.get("result"))

    async def _notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        assert self._process and self._process.stdin
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        self._process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await self._process.stdin.drain()

    async def _request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        assert self._process and self._process.stdin
        request_id = self._next_id
        self._next_id += 1
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending[request_id] = future
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        self._process.stdin.write((json.dumps(payload) + "\n").encode("utf-8"))
        await self._process.stdin.drain()
        return await future


async def register_mcp_tools(client: MCPClient, registry, *, prefix: str = "") -> None:
    from agent_framework.core.domain import ToolDefinition
    from agent_framework.core.tool_registry import create_pydantic_tool
    from pydantic import BaseModel, create_model

    tools = await client.list_tools()
    tool_prefix = f"{prefix}_" if prefix else ""

    for tool in tools:
        field_defs = {}
        properties = tool.input_schema.get("properties", {})
        required = set(tool.input_schema.get("required", []))
        for field_name, field_schema in properties.items():
            field_type = str if field_schema.get("type") == "string" else Any
            if field_name in required:
                field_defs[field_name] = (field_type, ...)
            else:
                field_defs[field_name] = (field_type | None, None)

        schema = create_model(f"MCP_{tool.name}", **field_defs)

        async def execute(args, ctx, tool_name=tool.name):
            del ctx
            return await client.call_tool(tool_name, args.model_dump(exclude_none=True))

        registry.register(
            create_pydantic_tool(
                ToolDefinition(
                    name=f"{tool_prefix}{tool.name}",
                    description=tool.description,
                    parameters=tool.input_schema,
                ),
                schema,
                execute,
            )
        )
