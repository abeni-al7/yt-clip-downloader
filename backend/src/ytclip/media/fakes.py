"""Test doubles: an Extractor serving locally generated media through a yt-dlp-shaped info dict."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ytclip.media.extractor import ExtractionError, classify_error


@dataclass(frozen=True, slots=True)
class SyntheticMedia:
    mp4_1080: Path
    mp4_720: Path
    webm_720: Path
    m4a: Path
    opus: Path
    duration_s: int = 60


class FakeExtractor:
    def __init__(
        self,
        media: SyntheticMedia,
        *,
        fail_with: str | None = None,
        no_audio: bool = False,
        title: str = "Fake Video: Test / Clip",
    ) -> None:
        self.media = media
        self.fail_with = fail_with
        self.no_audio = no_audio
        self.title = title
        self.calls = 0

    async def resolve(self, video_id: str) -> dict[str, Any]:
        self.calls += 1
        if self.fail_with:
            raise ExtractionError(classify_error(Exception(self.fail_with)), self.fail_with)
        m = self.media
        formats: list[dict[str, Any]] = [
            _video("137", m.mp4_1080, "avc1.640028", 1080, 1920, tbr=4000, ext="mp4"),
            _video("136", m.mp4_720, "avc1.4d401f", 720, 1280, tbr=2500, ext="mp4"),
            _video("247", m.webm_720, "vp9", 720, 1280, tbr=1500, ext="webm"),
        ]
        if not self.no_audio:
            formats += [
                _audio("140", m.m4a, "mp4a.40.2", ext="m4a", abr=128),
                _audio("251", m.opus, "opus", ext="webm", abr=128),
            ]
        return {
            "id": video_id,
            "title": self.title,
            "channel": "Fake Channel",
            "uploader": "Fake Channel",
            "duration": m.duration_s,
            "thumbnails": [
                {"url": "https://i.ytimg.com/vi/x/default.jpg", "width": 120, "height": 90},
                {"url": "https://i.ytimg.com/vi/x/hqdefault.jpg", "width": 480, "height": 360},
            ],
            "thumbnail": "https://i.ytimg.com/vi/x/hqdefault.jpg",
            "playable_in_embed": True,
            "live_status": "not_live",
            "is_live": False,
            "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
            "formats": formats,
        }


def _video(
    format_id: str, path: Path, vcodec: str, height: int, width: int, *, tbr: int, ext: str
) -> dict[str, Any]:
    return {
        "format_id": format_id,
        "url": str(path),
        "protocol": "https",
        "vcodec": vcodec,
        "acodec": "none",
        "height": height,
        "width": width,
        "fps": 24,
        "tbr": tbr,
        "vbr": tbr,
        "ext": ext,
        "http_headers": {"User-Agent": "fake/1.0"},
    }


def _audio(format_id: str, path: Path, acodec: str, *, ext: str, abr: int) -> dict[str, Any]:
    return {
        "format_id": format_id,
        "url": str(path),
        "protocol": "https",
        "vcodec": "none",
        "acodec": acodec,
        "abr": abr,
        "tbr": abr,
        "ext": ext,
        "http_headers": {"User-Agent": "fake/1.0"},
    }
