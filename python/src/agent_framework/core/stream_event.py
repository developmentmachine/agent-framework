from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any


def serialize_stream_event(event: Any) -> dict[str, Any]:
    if hasattr(event, "model_dump"):
        return event.model_dump()
    if is_dataclass(event):
        payload = asdict(event)
        name = event.__class__.__name__.replace("Event", "").lower()
        payload["type"] = "lifecycle" if name == "lifecycle" else name
        return payload
    if isinstance(event, dict):
        return event
    return {"value": str(event)}
