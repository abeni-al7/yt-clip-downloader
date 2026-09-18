"""YouTube link canonicalisation (research R12). User input never reaches the network from here."""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from ytclip.domain.models import VIDEO_ID_PATTERN, ErrorCode
from ytclip.domain.timestamps import parse_timestamp
from ytclip.errors import ApiError

VIDEO_ID_RE = re.compile(VIDEO_ID_PATTERN)

_HOSTS = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
        "youtu.be",
        "www.youtu.be",
    }
)
_SHORT_HOSTS = frozenset({"youtu.be", "www.youtu.be"})
_ID_PATH_PREFIXES = frozenset({"shorts", "live", "embed", "v"})


@dataclass(frozen=True, slots=True)
class ParsedUrl:
    video_id: str
    start_hint_s: int | None = None


def canonical_url(video_id: str) -> str:
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError(f"not a YouTube video id: {video_id!r}")
    return f"https://www.youtube.com/watch?v={video_id}"


def parse_youtube_url(text: str) -> ParsedUrl:
    candidate = text.strip()
    if not candidate:
        raise ApiError(ErrorCode.invalid_url)
    if VIDEO_ID_RE.match(candidate):
        return ParsedUrl(candidate)
    if "://" not in candidate:
        candidate = "https://" + candidate
    try:
        parts = urlsplit(candidate)
    except ValueError as exc:
        raise ApiError(ErrorCode.invalid_url) from exc

    host = (parts.hostname or "").lower()
    if host not in _HOSTS:
        raise ApiError(ErrorCode.invalid_url)

    query = parse_qs(parts.query)
    video_id = _video_id_from(host, parts.path, query)
    if video_id is None:
        if "list" in query:
            raise ApiError(ErrorCode.playlist_only)
        raise ApiError(ErrorCode.invalid_url)
    if not VIDEO_ID_RE.match(video_id):
        raise ApiError(ErrorCode.invalid_url)
    return ParsedUrl(video_id, _start_hint(query, parts.fragment))


def _video_id_from(host: str, path: str, query: dict[str, list[str]]) -> str | None:
    segments = [segment for segment in path.split("/") if segment]
    if host in _SHORT_HOSTS:
        return segments[0] if segments else None
    if segments and segments[0] == "watch":
        if query.get("v"):
            return query["v"][0]
        return segments[1] if len(segments) == 2 else None
    if len(segments) >= 2 and segments[0] in _ID_PATH_PREFIXES:
        return segments[1]
    return None


def _start_hint(query: dict[str, list[str]], fragment: str) -> int | None:
    for source in (query, parse_qs(fragment)):
        for key in ("t", "start"):
            for raw in source.get(key, ()):
                try:
                    return parse_timestamp(raw)
                except ValueError:
                    continue
    return None
