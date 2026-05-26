from __future__ import annotations

from datetime import datetime, timezone


class InMemoryMemoryProvider:
    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    def _key(self, scope: str, key: str) -> str:
        return f"{scope}:{key}"

    async def get(self, key: str, scope: str = "working") -> str | None:
        entry = self._store.get(self._key(scope, key))
        return None if entry is None else entry["value"]

    async def set(self, key: str, value: str, scope: str = "working") -> None:
        self._store[self._key(scope, key)] = {
            "key": key,
            "value": value,
            "scope": scope,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    async def search(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        results = [entry for entry in self._store.values() if _matches_memory_query(entry, query)]
        return sorted(results, key=lambda item: item["key"])[:limit]


def _matches_memory_query(entry: dict[str, str], query: str) -> bool:
    needle = query.lower()
    key = entry["key"].lower()
    value = entry["value"].lower()
    if needle in key or needle in value or (key and key in needle):
        return True
    tokens = [token for token in needle.split() if len(token) > 2]
    return any(token in key or token in value for token in tokens)
