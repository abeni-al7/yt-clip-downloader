"""Opt-in tests against real YouTube. Run with: YTCLIP_LIVE=1 uv run pytest tests/live -m live

They use the public "Me at the zoo" video (jNQXAC9IVRw, 19 s) so the download is tiny.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import httpx
import pytest

from ytclip.config import Settings
from ytclip.main import create_app

pytestmark = pytest.mark.live

LIVE_VIDEO = "jNQXAC9IVRw"


@pytest.fixture
def live_client() -> httpx.AsyncClient:
    if os.environ.get("YTCLIP_LIVE") != "1":
        pytest.skip("set YTCLIP_LIVE=1 to run live YouTube tests")
    settings = Settings.from_env()
    app = create_app(settings)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://live", timeout=300
    )


def _probe(data: bytes, suffix: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
        fh.write(data)
        path = fh.name
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    finally:
        Path(path).unlink(missing_ok=True)
    return json.loads(out)


async def test_live_resolve_and_short_clips(live_client: httpx.AsyncClient) -> None:
    async with live_client as client:
        resolve = await client.post("/api/videos/resolve", json={"url": LIVE_VIDEO})
        assert resolve.status_code == 200, resolve.text
        info = resolve.json()
        assert info["duration_s"] > 0 and info["resolutions"]["mp4"], info
        lowest = info["resolutions"]["mp4"][-1]["height"]

        mp4 = await client.get(
            "/api/clip",
            params={"v": LIVE_VIDEO, "start": 2, "end": 12, "format": "mp4", "height": lowest},
        )
        assert mp4.status_code == 200, mp4.text
        probe = _probe(mp4.content, ".mp4")
        assert 10 <= float(probe["format"]["duration"]) <= 20
        assert {s["codec_type"] for s in probe["streams"]} == {"video", "audio"}

        mp3 = await client.get(
            "/api/clip", params={"v": LIVE_VIDEO, "start": 2, "end": 12, "format": "mp3"}
        )
        assert mp3.status_code == 200, mp3.text
        probe = _probe(mp3.content, ".mp3")
        assert 10 <= float(probe["format"]["duration"]) <= 20
        assert probe["streams"][0]["codec_name"] == "mp3"
