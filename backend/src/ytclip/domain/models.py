"""Shared domain models (see specs/001-youtube-clip-download/data-model.md)."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

VIDEO_ID_PATTERN = r"^[A-Za-z0-9_-]{11}$"


class OutputFormat(StrEnum):
    mp4 = "mp4"
    webm = "webm"
    mp3 = "mp3"
    m4a = "m4a"
    ogg = "ogg"
    opus = "opus"

    @property
    def is_video(self) -> bool:
        return self in (OutputFormat.mp4, OutputFormat.webm)

    @property
    def kind(self) -> Literal["video", "audio"]:
        return "video" if self.is_video else "audio"

    @property
    def extension(self) -> str:
        return self.value

    @property
    def content_type(self) -> str:
        return _CONTENT_TYPES[self]


_CONTENT_TYPES: dict[OutputFormat, str] = {
    OutputFormat.mp4: "video/mp4",
    OutputFormat.webm: "video/webm",
    OutputFormat.mp3: "audio/mpeg",
    OutputFormat.m4a: "audio/mp4",
    OutputFormat.ogg: "audio/ogg",
    OutputFormat.opus: "audio/ogg",
}


class ErrorCode(StrEnum):
    invalid_request = "invalid_request"
    invalid_url = "invalid_url"
    playlist_only = "playlist_only"
    invalid_range = "invalid_range"
    unsupported_format = "unsupported_format"
    unsupported_resolution = "unsupported_resolution"
    no_audio_track = "no_audio_track"
    private = "private"
    age_restricted = "age_restricted"
    members_only = "members_only"
    video_unavailable = "video_unavailable"
    live_in_progress = "live_in_progress"
    drm_protected = "drm_protected"
    geo_blocked = "geo_blocked"
    bot_check = "bot_check"
    extraction_failed = "extraction_failed"
    processing_failed = "processing_failed"
    busy = "busy"


VideoCodec = Literal["avc1", "vp9", "av01"]


class VideoVariant(BaseModel):
    height: int
    fps: int
    vcodec: VideoCodec
    video_kbps: int


class AudioInfo(BaseModel):
    m4a_kbps: int | None = None
    opus_kbps: int | None = None


class Resolutions(BaseModel):
    mp4: list[VideoVariant]
    webm: list[VideoVariant]


class VideoInfo(BaseModel):
    video_id: str = Field(pattern=VIDEO_ID_PATTERN)
    canonical_url: str
    title: str
    channel: str
    thumbnail_url: str
    duration_s: int = Field(ge=1)
    embeddable: bool
    has_audio: bool
    resolutions: Resolutions
    audio: AudioInfo
    start_hint_s: int | None = None


class ClipParams(BaseModel):
    video_id: str = Field(pattern=VIDEO_ID_PATTERN)
    start_s: int = Field(ge=0)
    end_s: int = Field(ge=1)
    format: OutputFormat
    height: int | None = None


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    details: dict[str, Any] | None = None


class ToolStatus(BaseModel):
    available: bool
    version: str | None = None


class RuntimeStatus(BaseModel):
    name: str | None
    available: bool


class PotProviderStatus(BaseModel):
    url: str | None
    available: bool
    version: str | None = None


class StreamStatus(BaseModel):
    active: int
    max: int


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    yt_dlp_version: str
    ffmpeg: ToolStatus
    js_runtime: RuntimeStatus
    pot_provider: PotProviderStatus
    player_clients: list[str]
    streams: StreamStatus
    rss_mb: int | None = None
