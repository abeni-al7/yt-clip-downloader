"""Format inventory: usable yt-dlp formats, per-height variants, audio choices (R2, R8)."""

from collections.abc import Iterable
from typing import Any

from ytclip.domain.models import AudioInfo, OutputFormat, Resolutions, VideoCodec, VideoVariant

_MP4_PREFERENCE: dict[VideoCodec, int] = {"avc1": 0, "vp9": 1, "av01": 2}
_WEBM_PREFERENCE: dict[VideoCodec, int] = {"vp9": 0, "av01": 1}
_DIRECT_PROTOCOLS = frozenset({"https", "http"})
_HLS_PROTOCOLS = frozenset({"m3u8_native", "m3u8"})


def normalize_vcodec(vcodec: str | None) -> VideoCodec | None:
    if not vcodec or vcodec == "none":
        return None
    lowered = vcodec.lower()
    if lowered.startswith(("avc1", "h264")):
        return "avc1"
    if lowered.startswith(("vp9", "vp09")):
        return "vp9"
    if lowered.startswith("av01"):
        return "av01"
    return None


def carries_audio(fmt: dict[str, Any]) -> bool:
    return fmt.get("acodec") not in (None, "none")


def _carries_video(fmt: dict[str, Any]) -> bool:
    return fmt.get("vcodec") not in (None, "none") and bool(fmt.get("height"))


def is_aac(fmt: dict[str, Any]) -> bool:
    return str(fmt.get("acodec") or "").lower().startswith(("mp4a", "aac"))


def is_opus(fmt: dict[str, Any]) -> bool:
    return str(fmt.get("acodec") or "").lower().startswith("opus")


def is_vorbis(fmt: dict[str, Any]) -> bool:
    return str(fmt.get("acodec") or "").lower().startswith("vorbis")


def usable_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    """Direct https formats let ffmpeg seek with Range requests; HLS is a last resort."""
    formats = [
        fmt
        for fmt in info.get("formats") or []
        if fmt.get("url") and not fmt.get("has_drm") and (_carries_video(fmt) or carries_audio(fmt))
    ]
    direct = [fmt for fmt in formats if fmt.get("protocol") in _DIRECT_PROTOCOLS]
    if direct:
        return direct
    return [fmt for fmt in formats if fmt.get("protocol") in _HLS_PROTOCOLS]


def video_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        fmt
        for fmt in usable_formats(info)
        if normalize_vcodec(fmt.get("vcodec")) and fmt.get("height")
    ]


def audio_only_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        fmt
        for fmt in usable_formats(info)
        if carries_audio(fmt) and fmt.get("vcodec") in (None, "none")
    ]


def has_audio(info: dict[str, Any]) -> bool:
    return bool(audio_only_formats(info)) or any(carries_audio(fmt) for fmt in video_formats(info))


def _kbps(fmt: dict[str, Any]) -> int:
    return int(round(fmt.get("vbr") or fmt.get("tbr") or 0))


def _abr(fmt: dict[str, Any]) -> float:
    return float(fmt.get("abr") or fmt.get("tbr") or 0)


def _fps(fmt: dict[str, Any]) -> int:
    return int(round(fmt.get("fps") or 0))


def _preference(container: OutputFormat) -> dict[VideoCodec, int]:
    return _MP4_PREFERENCE if container is OutputFormat.mp4 else _WEBM_PREFERENCE


def _best_video(candidates: Iterable[dict[str, Any]], pref: dict[VideoCodec, int]) -> dict:
    return min(
        candidates,
        key=lambda fmt: (
            pref[normalize_vcodec(fmt["vcodec"])],  # type: ignore[index]
            -_kbps(fmt),
            -_fps(fmt),
        ),
    )


def pick_video_format(
    info: dict[str, Any], container: OutputFormat, height: int
) -> dict[str, Any] | None:
    """The exact height requested — never a lower fallback (FR-012)."""
    pref = _preference(container)
    candidates = [
        fmt
        for fmt in video_formats(info)
        if fmt.get("height") == height and normalize_vcodec(fmt.get("vcodec")) in pref
    ]
    return _best_video(candidates, pref) if candidates else None


def build_resolutions(info: dict[str, Any]) -> Resolutions:
    heights = sorted({int(fmt["height"]) for fmt in video_formats(info)}, reverse=True)
    variants: dict[OutputFormat, list[VideoVariant]] = {
        OutputFormat.mp4: [],
        OutputFormat.webm: [],
    }
    for container, out in variants.items():
        for height in heights:
            best = pick_video_format(info, container, height)
            if best is None:
                continue
            codec = normalize_vcodec(best.get("vcodec"))
            assert codec is not None
            out.append(
                VideoVariant(height=height, fps=_fps(best), vcodec=codec, video_kbps=_kbps(best))
            )
    return Resolutions(mp4=variants[OutputFormat.mp4], webm=variants[OutputFormat.webm])


def pick_audio_format(info: dict[str, Any], container: OutputFormat) -> dict[str, Any] | None:
    audios = audio_only_formats(info)
    if not audios:
        return None
    if container in (OutputFormat.mp4, OutputFormat.m4a):
        preferred = [fmt for fmt in audios if is_aac(fmt)]
    elif container in (OutputFormat.webm, OutputFormat.opus):
        preferred = [fmt for fmt in audios if is_opus(fmt)] or [
            fmt for fmt in audios if is_vorbis(fmt)
        ]
    else:
        preferred = audios
    return max(preferred or audios, key=_abr)


def build_audio(info: dict[str, Any]) -> AudioInfo:
    audios = audio_only_formats(info)
    aac = [int(round(_abr(fmt))) for fmt in audios if is_aac(fmt)]
    opus = [int(round(_abr(fmt))) for fmt in audios if is_opus(fmt)]
    return AudioInfo(m4a_kbps=max(aac) if aac else None, opus_kbps=max(opus) if opus else None)
