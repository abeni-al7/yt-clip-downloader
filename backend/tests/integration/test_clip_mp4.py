"""US1 — cut and download an MP4 clip through the real streaming path (offline, synthetic media)."""

import asyncio
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from starlette.requests import ClientDisconnect

from ytclip.config import Settings
from ytclip.main import create_app
from ytclip.media.fakes import FakeExtractor, SyntheticMedia
from ytclip.media.streamer import FfmpegStream

from ..conftest import FAKE_VIDEO_ID

Probe = Callable[[bytes, str], dict[str, Any]]


def clip_params(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "v": FAKE_VIDEO_ID,
        "start": 10,
        "end": 40,
        "format": "mp4",
        "height": 720,
    }
    params.update(overrides)
    return params


def video_stream(probe: dict[str, Any]) -> dict[str, Any]:
    return next(s for s in probe["streams"] if s["codec_type"] == "video")


def audio_stream(probe: dict[str, Any]) -> dict[str, Any]:
    return next(s for s in probe["streams"] if s["codec_type"] == "audio")


async def test_resolve_describes_the_video(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/videos/resolve", json={"url": f"https://youtu.be/{FAKE_VIDEO_ID}?t=90"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["video_id"] == FAKE_VIDEO_ID
    assert body["canonical_url"] == f"https://www.youtube.com/watch?v={FAKE_VIDEO_ID}"
    assert body["title"] == "Fake Video: Test / Clip"
    assert body["duration_s"] == 60
    assert body["has_audio"] is True and body["embeddable"] is True
    assert [v["height"] for v in body["resolutions"]["mp4"]] == [1080, 720]
    assert body["resolutions"]["mp4"][0]["vcodec"] == "avc1"
    assert [v["height"] for v in body["resolutions"]["webm"]] == [720]
    assert body["audio"] == {"m4a_kbps": 128, "opus_kbps": 128}
    assert body["start_hint_s"] == 90


async def test_resolve_is_cached_per_video(
    client: httpx.AsyncClient, extractor: FakeExtractor
) -> None:
    for _ in range(3):
        await client.post("/api/videos/resolve", json={"url": FAKE_VIDEO_ID})
    assert extractor.calls == 1


async def test_download_mp4_clip(client: httpx.AsyncClient, ffprobe_json: Probe) -> None:
    response = await client.get("/api/clip", params=clip_params())

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-clip-start-requested"] == "10"
    assert response.headers["x-clip-end-requested"] == "40"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "[00-00-10-00-00-40].mp4" in disposition

    probe = ffprobe_json(response.content, ".mp4")
    duration = float(probe["format"]["duration"])
    assert 30 <= duration <= 40, duration  # FR-014 / SC-012
    video = video_stream(probe)
    assert video["height"] == 720 and video["codec_name"] == "h264"
    assert audio_stream(probe)["codec_name"] == "aac"


async def test_timestamp_strings_behave_like_seconds(
    client: httpx.AsyncClient, ffprobe_json: Probe
) -> None:
    response = await client.get("/api/clip", params=clip_params(start="00:00:10", end="0:40"))

    assert response.status_code == 200, response.text
    assert response.headers["x-clip-start-requested"] == "10"
    assert response.headers["x-clip-end-requested"] == "40"
    assert 30 <= float(ffprobe_json(response.content, ".mp4")["format"]["duration"]) <= 40


async def test_start_between_keyframes_keeps_whole_range_and_sync(
    client: httpx.AsyncClient, ffprobe_json: Probe
) -> None:
    # Keyframes every 2 s in the fixture: start=11 must snap back to 10 and audio must follow.
    response = await client.get("/api/clip", params=clip_params(start=11, end=40, height=1080))

    assert response.status_code == 200, response.text
    probe = ffprobe_json(response.content, ".mp4")
    assert 30 <= float(probe["format"]["duration"]) <= 40
    starts = {float(s["start_time"]) for s in probe["streams"]}
    assert max(starts) - min(starts) < 0.1
    assert video_stream(probe)["height"] == 1080


async def test_full_video_has_no_duration_limit(
    client: httpx.AsyncClient, ffprobe_json: Probe
) -> None:
    response = await client.get("/api/clip", params=clip_params(start=0, end=60))

    assert response.status_code == 200, response.text
    assert float(ffprobe_json(response.content, ".mp4")["format"]["duration"]) >= 59


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"start": 40, "end": 40}, "invalid_range"),
        ({"start": 50, "end": 40}, "invalid_range"),
        ({"start": 10, "end": 61}, "invalid_range"),
        ({"start": "1:2:3:4"}, "invalid_range"),
        ({"v": "https://example.com/x"}, "invalid_url"),
        ({"v": "https://www.youtube.com/playlist?list=PLx"}, "playlist_only"),
        ({"height": 480}, "unsupported_resolution"),
        ({"height": None}, "unsupported_resolution"),
        ({"format": "flac"}, "unsupported_format"),
    ],
)
async def test_bad_requests_are_specific_400s(
    client: httpx.AsyncClient, overrides: dict[str, object], code: str
) -> None:
    params = {k: v for k, v in clip_params(**overrides).items() if v is not None}
    response = await client.get("/api/clip", params=params)

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["code"] == code and body["message"]


async def test_private_video_is_a_422_with_a_specific_code(
    settings: Settings, synthetic_media: SyntheticMedia
) -> None:
    app = create_app(settings, FakeExtractor(synthetic_media, fail_with="Private video"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        resolve = await c.post("/api/videos/resolve", json={"url": FAKE_VIDEO_ID})
        clip = await c.get("/api/clip", params=clip_params())

    assert resolve.status_code == 422 and resolve.json()["code"] == "private"
    assert clip.status_code == 422 and clip.json()["code"] == "private"
    assert app.state.slots.active == 0


async def test_browser_navigations_get_an_html_error_page(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/api/clip",
        params=clip_params(start=50, end=40),
        headers={"Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
    )

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("text/html")
    assert "Back to the app" in response.text
    assert 'href="http://localhost:5173"' in response.text
    assert "invalid_range" in response.text


async def test_busy_when_all_stream_slots_are_taken(
    synthetic_media: SyntheticMedia,
) -> None:
    app = create_app(
        Settings(max_concurrent_streams=1, js_runtime=None), FakeExtractor(synthetic_media)
    )
    app.state.slots.acquire()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://t"
        ) as c:
            response = await c.get("/api/clip", params=clip_params())
            html = await c.get("/api/clip", params=clip_params(), headers={"Accept": "text/html"})
    finally:
        app.state.slots.release()

    assert response.status_code == 503
    assert response.headers["retry-after"] == "15"
    assert response.json()["code"] == "busy"
    assert 'http-equiv="refresh"' in html.text


async def test_slot_is_released_after_a_completed_download(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    response = await client.get("/api/clip", params=clip_params())
    assert response.status_code == 200
    health = await client.get("/api/health")
    assert health.json()["streams"]["active"] == 0
    assert app.state.slots.active == 0


async def test_client_disconnect_kills_ffmpeg_and_frees_the_slot(app: FastAPI) -> None:
    """Drive the ASGI app directly with a `send` that fails like uvicorn does when the client
    goes away (ASGI spec 2.4 raises OSError from send)."""
    query = f"v={FAKE_VIDEO_ID}&start=0&end=60&format=mp4&height=1080".encode()
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/clip",
        "raw_path": b"/api/clip",
        "query_string": query,
        "root_path": "",
        "headers": [(b"host", b"test"), (b"accept", b"application/json")],
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
    }
    body_messages = 0

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        nonlocal body_messages
        if message["type"] == "http.response.body" and message.get("body"):
            body_messages += 1
            if body_messages >= 2:
                raise OSError("client went away")

    before = set(FfmpegStream.instances)
    with pytest.raises(ClientDisconnect):
        await app(scope, receive, send)

    new_streams = [s for s in FfmpegStream.instances if s not in before]
    assert new_streams, "the request should have started an ffmpeg stream"
    for _ in range(60):
        if all(s.returncode is not None for s in new_streams):
            break
        await asyncio.sleep(0.1)
    assert all(s.returncode is not None for s in new_streams), "ffmpeg was not reaped"
    assert app.state.slots.active == 0
