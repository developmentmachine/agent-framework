from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

from agent_framework.core.contracts import RunManager, RunRecord


class DefaultRunManager(RunManager):
    def __init__(self) -> None:
        self._runs: dict[str, RunRecord] = {}

    def create(self, session_id: str) -> RunRecord:
        record = RunRecord(
            run_id=str(uuid4()),
            session_id=session_id,
            status="pending",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        self._runs[record.run_id] = record
        return record

    def update(self, run_id: str, patch: dict) -> None:
        existing = self._runs.get(run_id)
        if existing is None:
            return
        self._runs[run_id] = replace(existing, **patch)

    def get(self, run_id: str) -> RunRecord | None:
        return self._runs.get(run_id)
