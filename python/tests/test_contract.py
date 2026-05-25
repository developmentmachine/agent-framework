import json
from pathlib import Path


def test_stream_event_schema_fixture():
    schema_path = Path(__file__).resolve().parents[2] / "spec" / "events" / "stream-event.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert "oneOf" in schema
