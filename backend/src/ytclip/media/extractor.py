"""YouTube metadata extraction behind a small seam, plus error classification (research R3, R11)."""

import asyncio
import logging
import re
from typing import Any, Protocol

from ytclip.config import Settings
from ytclip.domain.models import ErrorCode
from ytclip.domain.youtube_url import canonical_url
from ytclip.media.cache import InfoCache

log = logging.getLogger(__name__)


class ExtractionError(Exception):
    def __init__(self, code: ErrorCode, message: str = "") -> None:
        self.code = code
        self.message = message
        super().__init__(message or code.value)


class Extractor(Protocol):
    async def resolve(self, video_id: str) -> dict[str, Any]: ...


# Ordered: the first matching pattern wins, so the bot check must precede the age check
# (both start with "Sign in to confirm").
_PATTERNS: tuple[tuple[re.Pattern[str], ErrorCode], ...] = (
    (re.compile(r"confirm you.re not a bot", re.I), ErrorCode.bot_check),
    (re.compile(r"private video", re.I), ErrorCode.private),
    (
        re.compile(r"confirm your age|age.restricted|inappropriate for some users", re.I),
        ErrorCode.age_restricted,
    ),
    (
        re.compile(r"join this channel|members.only|channel's members", re.I),
        ErrorCode.members_only,
    ),
    (
        re.compile(
            r"video unavailable|has been removed|does not exist|no longer available"
            r"|this video is not available|account associated with this video has been terminated"
            r"|video has been terminated|is not a valid url|incomplete youtube id",
            re.I,
        ),
        ErrorCode.video_unavailable,
    ),
    (
        re.compile(r"available in your country|geo.?restricted|blocked it in your country", re.I),
        ErrorCode.geo_blocked,
    ),
    (re.compile(r"\bdrm\b", re.I), ErrorCode.drm_protected),
    (
        re.compile(r"live event will begin|premieres? in|this live event|is a live event", re.I),
        ErrorCode.live_in_progress,
    ),
)

_MESSAGE_PREFIXES = re.compile(r"^(?:ERROR:\s*)?(?:\[[\w:-]+\]\s*)?(?:[\w-]{11}:\s*)?")


def classify_error(exc: BaseException) -> ErrorCode:
    text = str(exc)
    for pattern, code in _PATTERNS:
        if pattern.search(text):
            return code
    return ErrorCode.extraction_failed


def trim_ytdlp_message(text: str, limit: int = 200) -> str:
    first_line = text.strip().splitlines()[0] if text.strip() else ""
    cleaned = _MESSAGE_PREFIXES.sub("", first_line).strip()
    return cleaned[:limit]


def check_availability(info: dict[str, Any]) -> None:
    live_status = info.get("live_status")
    if info.get("is_live") or live_status in {"is_live", "is_upcoming", "post_live"}:
        raise ExtractionError(ErrorCode.live_in_progress, "The video is a live stream")
    formats = info.get("formats") or []
    if not formats:
        raise ExtractionError(ErrorCode.video_unavailable, "No downloadable formats")
    if all(fmt.get("has_drm") for fmt in formats):
        raise ExtractionError(ErrorCode.drm_protected, "All formats are DRM-protected")
    if not info.get("duration"):
        raise ExtractionError(ErrorCode.video_unavailable, "The video duration is unknown")


class _YtDlpLogger:
    def debug(self, msg: str) -> None:
        if not msg.startswith("[debug] "):
            log.debug("%s", msg)

    def info(self, msg: str) -> None:
        log.debug("%s", msg)

    def warning(self, msg: str) -> None:
        log.warning("yt-dlp: %s", msg)

    def error(self, msg: str) -> None:
        log.error("yt-dlp: %s", msg)


class YtDlpExtractor:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def options(self) -> dict[str, Any]:
        s = self._settings
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "cachedir": False,
            "socket_timeout": 30,
            "retries": 2,
            "logger": _YtDlpLogger(),
            # {} disables every runtime; None would silently re-enable the default "deno".
            "js_runtimes": {s.js_runtime: {}} if s.js_runtime else {},
        }
        if s.ytdlp_cookies_file:
            opts["cookiefile"] = s.ytdlp_cookies_file
        if s.ytdlp_proxy:
            opts["proxy"] = s.ytdlp_proxy
        return opts

    async def resolve(self, video_id: str) -> dict[str, Any]:
        url = canonical_url(video_id)
        opts = self.options()

        def run() -> dict[str, Any]:
            import yt_dlp

            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return ydl.sanitize_info(info)

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            raise ExtractionError(classify_error(exc), trim_ytdlp_message(str(exc))) from exc


async def resolve_info(cache: InfoCache, extractor: Extractor, video_id: str) -> dict[str, Any]:
    cached = cache.get(video_id)
    if cached is not None:
        return cached
    info = await extractor.resolve(video_id)
    check_availability(info)
    cache.put(video_id, info)
    return info
