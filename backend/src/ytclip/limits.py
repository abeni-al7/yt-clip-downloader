"""Capacity guard for concurrent ffmpeg streams (not a quota — see research R5)."""

from ytclip.api.errors import ApiError
from ytclip.domain.models import ErrorCode

RETRY_AFTER_S = 15


class StreamSlots:
    """Counts active streams on the single event loop; never waits, answers `busy` instead."""

    def __init__(self, max_streams: int) -> None:
        self.max = max(1, max_streams)
        self.active = 0

    def acquire(self) -> None:
        if self.active >= self.max:
            raise ApiError(ErrorCode.busy, retry_after=RETRY_AFTER_S)
        self.active += 1

    def release(self) -> None:
        self.active = max(0, self.active - 1)
