"""YouTube metadata extraction behind a small seam, plus error classification (research R3, R11)."""

import asyncio
import contextlib
import logging
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from ytclip.config import Settings
from ytclip.domain.models import ErrorCode
from ytclip.domain.youtube_url import canonical_url
from ytclip.media.cache import InfoCache

log = logging.getLogger(__name__)


class ExtractionError(Exception):
    def __init__(
        self, code: ErrorCode, message: str = "", diagnostics: list[str] | None = None
    ) -> None:
        self.code = code
        self.message = message
        # yt-dlp warnings from this extraction (per-client outcomes); operator-facing.
        self.diagnostics = diagnostics or []
        super().__init__(message or code.value)


@dataclass(frozen=True, slots=True)
class PreparedCookies:
    """The operator's cookies, copied to a private writable file yt-dlp may rewrite."""

    path: str
    # LOGIN_INFO plus a SAPISID-family cookie: what yt-dlp itself treats as "logged in".
    logged_in: bool


class Extractor(Protocol):
    cookies: PreparedCookies | None

    async def resolve(self, video_id: str) -> dict[str, Any]: ...


_AUTH_COOKIES = {"SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"}


def prepare_cookies(source: str | None) -> PreparedCookies | None:
    """Copies `YTDLP_COOKIES_FILE` to a private 0600 file and checks it is usable.

    Two yt-dlp behaviours make the copy necessary: it rewrites the cookie file after every run
    (YouTube rotates session cookies) while Render mounts Secret Files read-only, and it runs
    silently *without* cookies when the file is unreadable. Problems are logged and reported by
    /api/health instead of surfacing later as an unexplained bot_check. Cookie values are never
    logged.
    """
    if not source:
        return None
    from yt_dlp.cookies import YoutubeDLCookieJar

    try:
        data = Path(source).read_bytes()
    except OSError as exc:
        log.error("YTDLP_COOKIES_FILE %s cannot be read (%s); running without cookies", source, exc)
        return None
    fd, path = tempfile.mkstemp(prefix="ytclip-cookies-", suffix=".txt")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    jar = YoutubeDLCookieJar(path)
    try:
        jar.load()
    except (OSError, ValueError):
        os.unlink(path)
        log.error(
            "YTDLP_COOKIES_FILE %s is not a Netscape-format cookies file; running without cookies",
            source,
        )
        return None
    names = {cookie.name for cookie in jar if cookie.domain.endswith("youtube.com")}
    logged_in = "LOGIN_INFO" in names and bool(names & _AUTH_COOKIES)
    if not logged_in:
        log.warning(
            "YTDLP_COOKIES_FILE %s holds no logged-in YouTube session (LOGIN_INFO + SAPISID); "
            "anonymous cookies do not clear YouTube's bot check",
            source,
        )
    log.info("yt-dlp cookies loaded from %s (logged in: %s)", source, logged_in)
    return PreparedCookies(path=path, logged_in=logged_in)


# Ordered: the first matching pattern wins, so the bot check must precede the age check
# (both start with "Sign in to confirm").
_PATTERNS: tuple[tuple[re.Pattern[str], ErrorCode], ...] = (
    (
        re.compile(r"confirm you.re not a bot|IP is likely being blocked", re.I),
        ErrorCode.bot_check,
    ),
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

# yt-dlp debug lines worth keeping for the operator: which pages were fetched, whether PO
# tokens were obtained and from which provider, and what each client's player response said.
# Token values, proxies and headers never appear in these lines.
_DIAGNOSTIC_DEBUG = re.compile(
    r"PO Token|\[pot\b|player response playability status|Solving JS challenges"
    r"|Downloading (?:webpage|.*client config|player API JSON|iframe API|initial data API JSON)"
    r"|formats require|Skipping player responses|Sign in|not a bot",
    re.I,
)
# With `youtube:pot_trace=true` these two lines carry the token itself; never expose them.
_DIAGNOSTIC_SECRET = re.compile(r"Generated POT|PO Token response")
_MAX_DIAGNOSTICS = 40


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


def parse_extractor_args(text: str) -> dict[str, dict[str, list[str]]]:
    """yt-dlp CLI syntax `KEY:arg=v1,v2;arg2=v` (repeatable, space-separated) → YoutubeDL dict."""
    result: dict[str, dict[str, list[str]]] = {}
    for chunk in text.split():
        key, sep, body = chunk.partition(":")
        if not sep or not key:
            raise ValueError(f"extractor arg {chunk!r} must look like KEY:arg=value")
        target = result.setdefault(key.strip().lower(), {})
        for pair in body.split(";"):
            if not pair.strip():
                continue
            name, eq, values = pair.partition("=")
            if not eq or not name.strip():
                raise ValueError(f"extractor arg {pair!r} must look like arg=value")
            target[name.strip().replace("-", "_")] = [v.strip() for v in values.split(",")]
    return result


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
    """Routes yt-dlp output to logging and keeps a trimmed, chronological trace for diagnostics."""

    def __init__(self) -> None:
        self.diagnostics: list[str] = []

    def _keep(self, msg: str, prefix: str = "") -> None:
        if len(self.diagnostics) < _MAX_DIAGNOSTICS:
            self.diagnostics.append(prefix + trim_ytdlp_message(msg, limit=300))

    def debug(self, msg: str) -> None:
        log.debug("yt-dlp: %s", msg)
        if _DIAGNOSTIC_DEBUG.search(msg) and not _DIAGNOSTIC_SECRET.search(msg):
            self._keep(msg)

    def info(self, msg: str) -> None:
        log.debug("yt-dlp: %s", msg)
        if _DIAGNOSTIC_DEBUG.search(msg) and not _DIAGNOSTIC_SECRET.search(msg):
            self._keep(msg)

    def warning(self, msg: str) -> None:
        log.warning("yt-dlp: %s", msg)
        self._keep(msg, "WARNING: ")

    def error(self, msg: str) -> None:
        # Not kept: yt-dlp raises the same text (recorded by resolve()), then logs a traceback.
        log.error("yt-dlp: %s", msg)


class YtDlpExtractor:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.cookies = prepare_cookies(settings.ytdlp_cookies_file)
        # yt-dlp rewrites the cookie file when a run ends; concurrent runs must not interleave.
        self._cookies_lock = threading.Lock()

    def extractor_args(self) -> dict[str, dict[str, list[str]]]:
        s = self._settings
        youtube: dict[str, list[str]] = {"fetch_pot": [s.ytdlp_fetch_pot]}
        if s.ytdlp_player_clients:
            youtube["player_client"] = list(s.ytdlp_player_clients)
        args: dict[str, dict[str, list[str]]] = {"youtube": youtube}
        if s.pot_provider_url:
            args["youtubepot-bgutilhttp"] = {"base_url": [s.pot_provider_url]}
        if s.ytdlp_extractor_args:
            for key, values in parse_extractor_args(s.ytdlp_extractor_args).items():
                args.setdefault(key, {}).update(values)
        return args

    def options(self, logger: _YtDlpLogger | None = None) -> dict[str, Any]:
        s = self._settings
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": False,
            # Verbose output only reaches our logger (DEBUG level) and the diagnostics allow-list.
            "verbose": True,
            "skip_download": True,
            "noplaylist": True,
            "cachedir": False,
            "socket_timeout": 30,
            "retries": 2,
            "logger": logger or _YtDlpLogger(),
            # {} disables every runtime; None would silently re-enable the default "deno".
            "js_runtimes": {s.js_runtime: {}} if s.js_runtime else {},
            "extractor_args": self.extractor_args(),
        }
        if self.cookies:
            opts["cookiefile"] = self.cookies.path
        if s.ytdlp_proxy:
            opts["proxy"] = s.ytdlp_proxy
        return opts

    async def resolve(self, video_id: str) -> dict[str, Any]:
        url = canonical_url(video_id)
        logger = _YtDlpLogger()
        opts = self.options(logger)

        guard = self._cookies_lock if self.cookies else contextlib.nullcontext()

        def run() -> dict[str, Any]:
            import yt_dlp

            with guard, yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return ydl.sanitize_info(info)

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            message = trim_ytdlp_message(str(exc))
            raise ExtractionError(
                classify_error(exc), message, [f"yt-dlp: {message}", *logger.diagnostics]
            ) from exc


async def resolve_info(cache: InfoCache, extractor: Extractor, video_id: str) -> dict[str, Any]:
    cached = cache.get(video_id)
    if cached is not None:
        return cached
    info = await extractor.resolve(video_id)
    check_availability(info)
    cache.put(video_id, info)
    return info
