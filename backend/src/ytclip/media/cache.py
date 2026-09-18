"""In-memory TTL + LRU cache for yt-dlp info dicts (research R4). Purely an optimisation."""

import time
from collections import OrderedDict
from typing import Any


class InfoCache:
    def __init__(self, ttl_s: float, max_entries: int) -> None:
        self._ttl_s = ttl_s
        self._max_entries = max(1, max_entries)
        self._entries: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()

    def get(self, key: str) -> dict[str, Any] | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, info = entry
        if time.monotonic() >= expires_at:
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return info

    def put(self, key: str, info: dict[str, Any]) -> None:
        self._entries[key] = (time.monotonic() + self._ttl_s, info)
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)
