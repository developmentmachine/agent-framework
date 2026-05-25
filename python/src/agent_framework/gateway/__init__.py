from __future__ import annotations

import asyncio
import json
from typing import Any

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
                    "payload": {"hello": "ok"},
                }
            )
        )

        async for message in websocket:
            incoming = json.loads(message)
            if incoming.get("type") != "req":
                continue
            if incoming.get("method") == "health":
                await websocket.send(
                    json.dumps({"type": "res", "id": incoming["id"], "ok": True, "payload": {"status": "ok"}})
                )
                continue
            if incoming.get("method") == "agent":
                params = incoming.get("params", {})
                from agent_framework.core.domain import AgentRunRequest

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
                                "payload": event.__dict__,
                                "seq": self._seq,
                            }
                        )
                    )
                await websocket.send(
                    json.dumps(
                        {
                            "type": "res",
                            "id": incoming["id"],
                            "ok": True,
                            "payload": {"status": "completed"},
                        }
                    )
                )

    async def start(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets package is required")
        async with websockets.serve(self._handle, self._host, self._port):
            await asyncio.Future()


class SqliteSessionStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    async def init(self) -> None:
        # Phase 2 skeleton for persistent sessions.
        return None
