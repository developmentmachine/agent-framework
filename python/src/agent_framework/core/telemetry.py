from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from agent_framework.core.contracts import StreamEvent


@dataclass
class TelemetrySpan:
    name: str
    start_ms: float
    end_ms: float | None = None
    attributes: dict[str, Any] | None = None


class SpanExporter(Protocol):
    def export(self, spans: list[TelemetrySpan]) -> None: ...


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
        if event.type == "tool" and event.status == "start":
            self.spans.append(
                TelemetrySpan(
                    name=f"tool:{event.name}",
                    start_ms=time.time() * 1000,
                    attributes={"call_id": event.call_id},
                )
            )
        if event.type == "tool" and event.status != "start":
            for span in reversed(self.spans):
                if span.name == f"tool:{event.name}" and span.end_ms is None:
                    span.end_ms = time.time() * 1000
                    break


class ConsoleSpanExporter:
    def export(self, spans: list[TelemetrySpan]) -> None:
        for span in spans:
            if span.end_ms is None:
                continue
            duration_ms = span.end_ms - span.start_ms
            print(f"[otel] {span.name} {duration_ms:.2f}ms", span.attributes or {})


class HttpOtelExporter:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint

    def export(self, spans: list[TelemetrySpan]) -> None:
        import httpx

        payload = {
            "resourceSpans": [
                {
                    "scopeSpans": [
                        {
                            "spans": [
                                {
                                    "name": span.name,
                                    "startTimeUnixNano": str(int(span.start_ms * 1_000_000)),
                                    "endTimeUnixNano": str(int((span.end_ms or span.start_ms) * 1_000_000)),
                                    "attributes": [
                                        {"key": key, "value": {"stringValue": str(value)}}
                                        for key, value in (span.attributes or {}).items()
                                    ],
                                }
                                for span in spans
                                if span.end_ms is not None
                            ]
                        }
                    ]
                }
            ]
        }

        if not payload["resourceSpans"][0]["scopeSpans"][0]["spans"]:
            return

        httpx.post(self.endpoint, json=payload, timeout=5.0)


def attach_telemetry(bus, collector: InMemoryTelemetryCollector):
    return bus.subscribe(collector.on_stream_event)


@dataclass
class TelemetryPipeline:
    collector: InMemoryTelemetryCollector
    exporters: list[SpanExporter] = field(default_factory=lambda: [ConsoleSpanExporter()])
    _detach: Any = None

    def flush(self) -> None:
        finished = [span for span in self.collector.spans if span.end_ms is not None]
        for exporter in self.exporters:
            exporter.export(finished)


def create_telemetry_pipeline(bus, exporters: list[SpanExporter] | None = None) -> TelemetryPipeline:
    collector = InMemoryTelemetryCollector()
    pipeline = TelemetryPipeline(collector=collector, exporters=exporters or [ConsoleSpanExporter()])
    pipeline._detach = attach_telemetry(bus, collector)
    return pipeline
