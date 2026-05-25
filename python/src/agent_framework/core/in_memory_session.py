from __future__ import annotations

from datetime import datetime, timezone

from agent_framework.core.contracts import SessionRecord, SessionStore
from agent_framework.core.domain import Message


class InMemorySessionStore(SessionStore):
    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}

    async def get(self, session_id: str) -> SessionRecord | None:
        return self._sessions.get(session_id)

    async def save(self, session: SessionRecord) -> None:
        self._sessions[session.id] = session

    async def append_messages(self, session_id: str, messages: list[Message]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        existing = self._sessions.get(session_id)
        if existing is None:
            self._sessions[session_id] = SessionRecord(
                id=session_id,
                messages=list(messages),
                created_at=now,
                updated_at=now,
            )
            return
        existing.messages.extend(messages)
        existing.updated_at = now
