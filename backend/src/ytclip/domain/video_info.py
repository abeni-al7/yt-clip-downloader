"""Assemble the VideoInfo read model from a yt-dlp info dict."""

from typing import Any

from ytclip.domain.estimate import build_audio, build_resolutions, has_audio
from ytclip.domain.models import VideoInfo
from ytclip.domain.youtube_url import ParsedUrl, canonical_url


def build_video_info(info: dict[str, Any], parsed: ParsedUrl) -> VideoInfo:
    return VideoInfo(
        video_id=parsed.video_id,
        canonical_url=canonical_url(parsed.video_id),
        title=str(info.get("title") or "Untitled video"),
        channel=str(info.get("channel") or info.get("uploader") or ""),
        thumbnail_url=best_thumbnail(info, parsed.video_id),
        duration_s=max(1, int(round(float(info.get("duration") or 0)))),
        embeddable=bool(info.get("playable_in_embed", True)),
        has_audio=has_audio(info),
        resolutions=build_resolutions(info),
        audio=build_audio(info),
        start_hint_s=parsed.start_hint_s,
    )


def best_thumbnail(info: dict[str, Any], video_id: str) -> str:
    candidates = [thumb for thumb in (info.get("thumbnails") or []) if thumb.get("url")]
    if candidates:
        best = max(candidates, key=lambda t: (t.get("width") or 0, t.get("preference") or 0))
        return str(best["url"])
    return str(info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
