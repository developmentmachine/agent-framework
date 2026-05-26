from __future__ import annotations

import asyncio
import json
from typing import Any

from agent_framework.core.domain import AgentRunRequest
from agent_framework.core.stream_event import serialize_stream_event

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None


class AgentGateway:
    def __init__(self, runtime, host: str = "127.0.0.1", port: int = 18789) -> None:
        self._runtime = runtime
        self._host = host
        self._port = port
        self._seq = 0
        self._server = None

    async def _handle(self, websocket) -> None:
        raw = await websocket.recv()
        frame = json.loads(raw)
        if frame.get("type") != "req" or frame.get("method") != "connect":
            await websocket.close(1008, "First frame must be connect")
            return

        await websocket.send(
            json.dumps(
                {
                    "type": "res",
                    "id": frame["id"],
                    "ok": True,
                    "payload": {
                        "hello": "ok",
                        "features": {
                            "methods": ["agent", "health", "tools.list", "sessions.list", "memory.search"],
                            "events": ["agent"],
                        },
                    },
                }
            )
        )

        async for message in websocket:
            incoming = json.loads(message)
            if incoming.get("type") != "req":
                continue

            method = incoming.get("method")
            request_id = incoming.get("id", "")
            params = incoming.get("params", {})

            try:
                if method == "health":
                    await websocket.send(
                        json.dumps({"type": "res", "id": request_id, "ok": True, "payload": {"status": "ok"}})
                    )
                    continue

                if method == "tools.list":
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "res",
                                "id": request_id,
                                "ok": True,
                                "payload": {"tools": self._runtime.tools.list()},
                            }
                        )
                    )
                    continue

                if method == "sessions.list":
                    sessions = await self._runtime.sessions.list()
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "res",
                                "id": request_id,
                                "ok": True,
                                "payload": {
                                    "sessions": [
                                        {
                                            "id": session.id,
                                            "messageCount": len(session.messages),
                                            "updatedAt": session.updated_at,
                                        }
                                        for session in sessions
                                    ]
                                },
                            }
                        )
                    )
                    continue

                if method == "memory.search":
                    entries = await self._runtime.memory.search(
                        str(params.get("query", "")),
                        int(params.get("limit", 10)),
                    )
                    await websocket.send(
                        json.dumps(
                            {"type": "res", "id": request_id, "ok": True, "payload": {"entries": entries}}
                        )
                    )
                    continue

                if method == "agent":
                    async for event in self._runtime.router.route(
                        AgentRunRequest(
                            session_id=str(params.get("sessionId", "default")),
                            input={"role": "user", "content": str(params.get("message", ""))},
                        )
                    ):
                        self._seq += 1
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "event",
                                    "event": "agent",
                                    "payload": serialize_stream_event(event),
                                    "seq": self._seq,
                                }
                            )
                        )
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "res",
                                "id": request_id,
                                "ok": True,
                                "payload": {"status": "completed"},
                            }
                        )
                    )
                    continue

                await websocket.send(
                    json.dumps(
                        {
                            "type": "res",
                            "id": request_id,
                            "ok": False,
                            "error": f"Unknown method: {method}",
                        }
                    )
                )
            except Exception as exc:  # noqa: BLE001
                await websocket.send(
                    json.dumps({"type": "res", "id": request_id, "ok": False, "error": str(exc)})
                )

    async def start(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets package is required")
        self._server = await websockets.serve(self._handle, self._host, self._port)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
