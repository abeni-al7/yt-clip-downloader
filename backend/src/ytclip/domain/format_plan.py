"""Turn a resolved video + clip parameters into an ffmpeg command (research R2). Pure function.

Cutting is done with input-side seeking and stream copy. Video is never re-encoded, so the clip
starts at a keyframe: the caller probes the keyframe at or before the requested start
(`media/keyframe.py`) and both inputs are seeked to it, which keeps audio and video aligned and
lets the audio cover the lead-in. One extra second is read so the requested end is always inside
the clip (FR-014). Audio is transcoded only when the container cannot carry the source codec, or
for MP3/OGG which YouTube does not serve.
"""

from dataclasses import dataclass
from typing import Any

from ytclip.domain.estimate import (
    build_resolutions,
    carries_audio,
    is_aac,
    is_opus,
    is_vorbis,
    pick_audio_format,
    pick_video_format,
)
from ytclip.domain.models import ClipParams, ErrorCode, OutputFormat
from ytclip.errors import ApiError

END_PADDING_S = 1

_RECONNECT = [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_on_network_error", "1",
    "-reconnect_delay_max", "30",
]  # fmt: skip
# Pipe output is not seekable, so MP4/M4A must be fragmented.
_FMP4_VIDEO = ["-movflags", "frag_keyframe+empty_moov+default_base_moof"]
_FMP4_AUDIO = ["-movflags", "empty_moov+default_base_moof", "-frag_duration", "5000000"]


@dataclass(frozen=True, slots=True)
class Sources:
    video: dict[str, Any] | None
    audio: dict[str, Any]


@dataclass(frozen=True, slots=True)
class FfmpegPlan:
    argv: list[str]
    content_type: str
    extension: str
    video_format_id: str | None
    audio_format_id: str | None
    seek_s: float
    duration_s: float


def select_sources(info: dict[str, Any], params: ClipParams) -> Sources:
    """Pick the yt-dlp formats to read, or raise the matching ApiError."""
    fmt = params.format
    if fmt.is_video:
        if params.height is None:
            raise ApiError(
                ErrorCode.unsupported_resolution,
                "Choose a resolution for video formats.",
                details={"field": "height"},
            )
        video = pick_video_format(info, fmt, params.height)
        if video is None:
            offered = getattr(build_resolutions(info), fmt.value)
            raise ApiError(
                ErrorCode.unsupported_resolution,
                details={"field": "height", "available": [variant.height for variant in offered]},
            )
        if carries_audio(video):
            return Sources(video=video, audio=video)
        audio = pick_audio_format(info, fmt)
        if audio is None:
            raise ApiError(ErrorCode.no_audio_track)
        return Sources(video=video, audio=audio)

    if params.height is not None:
        raise ApiError(
            ErrorCode.unsupported_resolution,
            "Audio formats do not take a resolution.",
            details={"field": "height"},
        )
    audio = pick_audio_format(info, fmt)
    if audio is None:
        raise ApiError(ErrorCode.no_audio_track)
    return Sources(video=None, audio=audio)


def build_plan(
    sources: Sources,
    params: ClipParams,
    *,
    seek_s: float | None = None,
    encoders: frozenset[str] | None = None,
    ffmpeg_bin: str = "ffmpeg",
) -> FfmpegPlan:
    """`seek_s` is the keyframe position to start reading from; defaults to the requested start."""
    fmt = params.format
    seek = float(params.start_s if seek_s is None else min(seek_s, params.start_s))
    duration = params.end_s + END_PADDING_S - seek
    seek_text, duration_text = _seconds(seek), _seconds(duration)

    if sources.video is not None:
        inputs = [sources.video]
        maps = ["-map", "0:v:0"]
        if sources.audio is sources.video:
            maps += ["-map", "0:a:0"]
        else:
            inputs.append(sources.audio)
            maps += ["-map", "1:a:0"]
        codec = ["-c:v", "copy", *audio_codec_args(fmt, sources.audio, encoders)]
        mux = [*_FMP4_VIDEO, "-f", "mp4"] if fmt is OutputFormat.mp4 else ["-f", "webm"]
    else:
        inputs = [sources.audio]
        maps = ["-map", "0:a:0", "-vn"]
        codec = audio_codec_args(fmt, sources.audio, encoders)
        mux = _AUDIO_MUX[fmt]

    argv = [ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-nostdin"]
    for source in inputs:
        argv += [*_input_options(source, seek_text, duration_text), "-i", str(source["url"])]
    # Output-side -t lets muxers that write a duration up front (WebM) write the right one.
    argv += [*maps, *codec, "-avoid_negative_ts", "make_zero", "-t", duration_text, *mux, "pipe:1"]

    return FfmpegPlan(
        argv=argv,
        content_type=fmt.content_type,
        extension=fmt.extension,
        video_format_id=sources.video.get("format_id") if sources.video else None,
        audio_format_id=sources.audio.get("format_id"),
        seek_s=seek,
        duration_s=duration,
    )


_AUDIO_MUX: dict[OutputFormat, list[str]] = {
    OutputFormat.m4a: [*_FMP4_AUDIO, "-f", "mp4"],
    OutputFormat.opus: ["-f", "opus"],
    # No Xing header: it cannot be rewritten on a pipe and a zeroed one breaks duration display.
    OutputFormat.mp3: ["-write_xing", "0", "-f", "mp3"],
    OutputFormat.ogg: ["-f", "ogg"],
}


def audio_codec_args(
    fmt: OutputFormat, audio: dict[str, Any], encoders: frozenset[str] | None = None
) -> list[str]:
    if fmt in (OutputFormat.mp4, OutputFormat.m4a):
        return ["-c:a", "copy"] if is_aac(audio) else ["-c:a", "aac", "-b:a", "160k"]
    if fmt is OutputFormat.webm:
        if is_opus(audio) or is_vorbis(audio):
            return ["-c:a", "copy"]
        return ["-c:a", "libopus", "-b:a", "128k"]
    if fmt is OutputFormat.opus:
        return ["-c:a", "copy"] if is_opus(audio) else ["-c:a", "libopus", "-b:a", "128k"]
    if fmt is OutputFormat.mp3:
        # Constant bitrate keeps player duration estimates right without a Xing header.
        return ["-c:a", "libmp3lame", "-b:a", "192k"]
    if encoders is None or "libvorbis" in encoders:
        return ["-c:a", "libvorbis", "-q:a", "6"]
    return ["-c:a", "vorbis", "-strict", "experimental", "-b:a", "192k"]


def _input_options(fmt: dict[str, Any], seek_text: str, duration_text: str) -> list[str]:
    options: list[str] = []
    url = str(fmt["url"])
    if url.startswith(("http://", "https://")):
        options += _RECONNECT
        headers = header_blob(fmt.get("http_headers") or {})
        if headers:
            options += ["-headers", headers]
    options += ["-ss", seek_text, "-t", duration_text]
    return options


def header_blob(headers: dict[str, Any]) -> str:
    """`Key: Value\\r\\n` lines for ffmpeg's -headers; CR/LF are stripped so a value cannot inject
    another header."""
    lines = []
    for key, value in headers.items():
        name = _strip_crlf(str(key))
        content = _strip_crlf(str(value))
        if name and content and ":" not in name:
            lines.append(f"{name}: {content}\r\n")
    return "".join(lines)


def _strip_crlf(value: str) -> str:
    return value.replace("\r", "").replace("\n", "").strip()


def _seconds(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") if value != int(value) else str(int(value))
