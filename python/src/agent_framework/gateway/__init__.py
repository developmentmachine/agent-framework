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
        self._active_runs: dict[str, asyncio.Event] = {}

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
                            "methods": [
                                "agent",
                                "agent.cancel",
                                "health",
                                "tools.list",
                                "sessions.list",
                                "memory.search",
                            ],
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

                if method == "agent.cancel":
                    run_id = str(params.get("runId", ""))
                    cancel_event = self._active_runs.get(run_id)
                    if cancel_event is not None:
                        cancel_event.set()
                        self._active_runs.pop(run_id, None)
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "res",
                                "id": request_id,
                                "ok": True,
                                "payload": {"cancelled": cancel_event is not None},
                            }
                        )
                    )
                    continue

                if method == "agent":
                    session_id = str(params.get("sessionId", "default"))
                    message = str(params.get("message", ""))
                    run = self._runtime.runs.create(session_id)
                    cancel_event = asyncio.Event()
                    self._active_runs[run.run_id] = cancel_event

                    async for event in self._runtime.router.route(
                        AgentRunRequest(
                            session_id=session_id,
                            input={"role": "user", "content": message},
                            cancel_event=cancel_event,
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

                    self._active_runs.pop(run.run_id, None)
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "res",
                                "id": request_id,
                                "ok": True,
                                "payload": {"status": "completed", "runId": run.run_id},
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

    async def start(self) -> int:
        if websockets is None:
            raise RuntimeError("websockets package is required")
        self._server = await websockets.serve(self._handle, self._host, self._port)
        return self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
