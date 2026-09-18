"""US2 — every output format streams correctly with the right codecs and container."""

from collections.abc import Callable
from typing import Any

import httpx
import pytest

from ytclip.config import Settings
from ytclip.main import create_app
from ytclip.media.fakes import FakeExtractor, SyntheticMedia

from ..conftest import FAKE_VIDEO_ID

Probe = Callable[[bytes, str], dict[str, Any]]

CASES = [
    # format, height, content-type, expected (codec_type, codec_name) pairs
    ("mp4", 720, "video/mp4", {("video", "h264"), ("audio", "aac")}),
    ("webm", 720, "video/webm", {("video", "vp9"), ("audio", "opus")}),
    ("mp3", None, "audio/mpeg", {("audio", "mp3")}),
    ("m4a", None, "audio/mp4", {("audio", "aac")}),
    ("ogg", None, "audio/ogg", {("audio", "vorbis")}),
    ("opus", None, "audio/ogg", {("audio", "opus")}),
]


@pytest.mark.parametrize(("fmt", "height", "content_type", "codecs"), CASES)
async def test_each_format_streams_the_requested_range(
    client: httpx.AsyncClient,
    ffprobe_json: Probe,
    fmt: str,
    height: int | None,
    content_type: str,
    codecs: set[tuple[str, str]],
) -> None:
    params: dict[str, object] = {"v": FAKE_VIDEO_ID, "start": 10, "end": 30, "format": fmt}
    if height is not None:
        params["height"] = height

    response = await client.get("/api/clip", params=params)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == content_type
    assert f"[00-00-10-00-00-30].{fmt}" in response.headers["content-disposition"]
    probe = ffprobe_json(response.content, f".{fmt}")
    assert {(s["codec_type"], s["codec_name"]) for s in probe["streams"]} == codecs
    duration = float(probe["format"]["duration"])
    assert 20 <= duration <= 30, duration


async def test_audio_format_with_height_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/api/clip",
        params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "mp3", "height": 720},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "unsupported_resolution" and body["details"] == {"field": "height"}


async def test_video_format_without_height_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/api/clip", params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "webm"}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_resolution"


async def test_unknown_format_is_rejected_with_the_supported_list(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(
        "/api/clip", params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "flac"}
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "unsupported_format"
    assert body["details"]["supported"] == ["mp4", "webm", "mp3", "m4a", "ogg", "opus"]


async def test_video_without_audio_cannot_produce_audio_formats(
    settings: Settings, synthetic_media: SyntheticMedia
) -> None:
    app = create_app(settings, FakeExtractor(synthetic_media, no_audio=True))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        resolve = await c.post("/api/videos/resolve", json={"url": FAKE_VIDEO_ID})
        mp3 = await c.get(
            "/api/clip", params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "mp3"}
        )
        mp4 = await c.get(
            "/api/clip",
            params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "mp4", "height": 720},
        )

    assert resolve.json()["has_audio"] is False
    assert mp3.status_code == 400 and mp3.json()["code"] == "no_audio_track"
    # A video-only source cannot be muxed with audio either: same specific reason.
    assert mp4.status_code == 400 and mp4.json()["code"] == "no_audio_track"
    assert app.state.slots.active == 0


async def test_webm_offers_only_vp9_heights(client: httpx.AsyncClient) -> None:
    resolve = await client.post("/api/videos/resolve", json={"url": FAKE_VIDEO_ID})
    assert [v["height"] for v in resolve.json()["resolutions"]["webm"]] == [720]

    response = await client.get(
        "/api/clip",
        params={"v": FAKE_VIDEO_ID, "start": 0, "end": 10, "format": "webm", "height": 1080},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "unsupported_resolution"
    assert body["details"] == {"field": "height", "available": [720]}
