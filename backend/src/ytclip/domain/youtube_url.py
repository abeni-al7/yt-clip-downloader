"""YouTube link canonicalisation (research R12)."""

import re
from dataclasses import dataclass

from ytclip.domain.models import VIDEO_ID_PATTERN

VIDEO_ID_RE = re.compile(VIDEO_ID_PATTERN)


@dataclass(frozen=True, slots=True)
class ParsedUrl:
    video_id: str
    start_hint_s: int | None = None


def canonical_url(video_id: str) -> str:
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError(f"not a YouTube video id: {video_id!r}")
    return f"https://www.youtube.com/watch?v={video_id}"
