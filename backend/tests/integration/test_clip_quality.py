"""US4 — the delivered clip is exactly the requested resolution, never a lower fallback."""

from collections.abc import Callable
from typing import Any

import httpx
import pytest

from ..conftest import FAKE_VIDEO_ID

Probe = Callable[[bytes, str], dict[str, Any]]


def _height(probe: dict[str, Any]) -> int:
    return next(s for s in probe["streams"] if s["codec_type"] == "video")["height"]


@pytest.mark.parametrize(("fmt", "height"), [("mp4", 720), ("mp4", 1080), ("webm", 720)])
async def test_delivered_height_matches_the_request(
    client: httpx.AsyncClient, ffprobe_json: Probe, fmt: str, height: int
) -> None:
    response = await client.get(
        "/api/clip",
        params={"v": FAKE_VIDEO_ID, "start": 5, "end": 15, "format": fmt, "height": height},
    )

    assert response.status_code == 200, response.text
    assert _height(ffprobe_json(response.content, f".{fmt}")) == height


@pytest.mark.parametrize(("fmt", "height"), [("mp4", 480), ("mp4", 2160), ("webm", 1080)])
async def test_unoffered_heights_are_refused_not_downgraded(
    client: httpx.AsyncClient, fmt: str, height: int
) -> None:
    response = await client.get(
        "/api/clip",
        params={"v": FAKE_VIDEO_ID, "start": 5, "end": 15, "format": fmt, "height": height},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "unsupported_resolution"
    assert height not in body["details"]["available"]


async def test_resolve_lists_heights_per_container_with_codecs(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/videos/resolve", json={"url": FAKE_VIDEO_ID})
    body = response.json()

    assert body["resolutions"]["mp4"] == [
        {"height": 1080, "fps": 24, "vcodec": "avc1", "video_kbps": 4000},
        {"height": 720, "fps": 24, "vcodec": "avc1", "video_kbps": 2500},
    ]
    assert body["resolutions"]["webm"] == [
        {"height": 720, "fps": 24, "vcodec": "vp9", "video_kbps": 1500},
    ]
