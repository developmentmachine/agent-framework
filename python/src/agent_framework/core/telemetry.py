from __future__ import annotations

from dataclasses import dataclass, field

from agent_framework.core.contracts import StreamEvent


@dataclass
class TelemetrySpan:
    name: str
    start_ms: float
    end_ms: float | None = None
    attributes: dict | None = None


class InMemoryTelemetryCollector:
    def __init__(self) -> None:
        self.spans: list[TelemetrySpan] = []
        self.events: list[StreamEvent] = []

    def on_stream_event(self, event: StreamEvent) -> None:
        import time

        self.events.append(event)
        if event.type == "lifecycle" and event.phase == "start":
            self.spans.append(TelemetrySpan(name=f"run:{event.run_id}", start_ms=time.time() * 1000))
        if event.type == "lifecycle" and event.phase in {"end", "error"}:
            for span in reversed(self.spans):
                if span.end_ms is None:
                    span.end_ms = time.time() * 1000
                    break
