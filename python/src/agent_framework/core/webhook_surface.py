from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any

from agent_framework.core.domain import AgentRunRequest
from agent_framework.runtime import AgentRuntime


def _serialize_event(event: Any) -> dict[str, Any]:
    if hasattr(event, "model_dump"):
        return event.model_dump()
    if is_dataclass(event):
        payload = asdict(event)
        payload["type"] = event.__class__.__name__.replace("Event", "").lower()
        if payload["type"] == "lifecycle":
            payload["type"] = "lifecycle"
        return payload
    if isinstance(event, dict):
        return event
    return {"value": str(event)}


@dataclass
class WebhookSurfaceOptions:
    runtime: AgentRuntime
    host: str = "127.0.0.1"
    port: int = 8787
    path: str = "/webhook"


class WebhookSurface:
    def __init__(self, options: WebhookSurfaceOptions) -> None:
        self._options = options
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> int:
        self._server = await asyncio.start_server(
            self._handle_client,
            self._options.host,
            self._options.port,
        )
        return self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = (await reader.readline()).decode("utf-8", errors="ignore").strip()
            if not request_line:
                return

            headers: dict[str, str] = {}
            while True:
                line = (await reader.readline()).decode("utf-8", errors="ignore").strip()
                if not line:
                    break
                key, _, value = line.partition(":")
                headers[key.strip().lower()] = value.strip()

            content_length = int(headers.get("content-length", "0"))
            body = (await reader.readexactly(content_length)).decode("utf-8") if content_length else ""
            method, target, _ = request_line.split(" ", 2)

            if method != "POST" or target != self._options.path:
                await self._write_response(writer, 404, {"ok": False, "error": "Not found"})
                return

            payload = json.loads(body) if body else {}
            events = []
            async for event in self._options.runtime.router.route(
                AgentRunRequest(
                    session_id=payload.get("sessionId", "webhook"),
                    input={"role": "user", "content": payload.get("message", "")},
                )
            ):
                events.append(_serialize_event(event))

            await self._write_response(writer, 200, {"ok": True, "events": events, "reason": {"kind": "completed"}})
        except Exception as exc:  # noqa: BLE001
            await self._write_response(writer, 500, {"ok": False, "error": str(exc)})
        finally:
            writer.close()
            await writer.wait_closed()

    async def _write_response(self, writer: asyncio.StreamWriter, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        reason = "OK" if status == 200 else "Error"
        writer.write(
            (
                f"HTTP/1.1 {status} {reason}\r\n"
                "Content-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n\r\n"
            ).encode("utf-8")
        )
        writer.write(body)
        await writer.drain()
