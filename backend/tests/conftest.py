"""Shared fixtures: synthetic media generated once per session with ffmpeg, a fake extractor."""

import json
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from ytclip.config import Settings
from ytclip.main import create_app
from ytclip.media.fakes import FakeExtractor, SyntheticMedia

MEDIA_SECONDS = 60
FAKE_VIDEO_ID = "dQw4w9WgXcQ"


def _ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        check=True,
        timeout=600,
    )


def _generate_media(directory: Path) -> SyntheticMedia:
    seconds = str(MEDIA_SECONDS)
    # A keyframe every 2 s (48 frames at 24 fps) keeps cut boundaries predictable.
    x264 = [
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-sc_threshold",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-an",
    ]
    mp4_1080 = directory / "video-1080.mp4"
    mp4_720 = directory / "video-720.mp4"
    webm_720 = directory / "video-720.webm"
    m4a = directory / "audio.m4a"
    opus = directory / "audio-opus.webm"

    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=24",
        "-t",
        seconds,
        *x264,
        "-movflags",
        "+faststart",
        str(mp4_1080),
    )
    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=24",
        "-t",
        seconds,
        *x264,
        "-movflags",
        "+faststart",
        str(mp4_720),
    )
    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=24",
        "-t",
        seconds,
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-b:v",
        "600k",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(webm_720),
    )
    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        seconds,
        "-ac",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        str(m4a),
    )
    _ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        seconds,
        "-ac",
        "2",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        str(opus),
    )
    return SyntheticMedia(mp4_1080, mp4_720, webm_720, m4a, opus, duration_s=MEDIA_SECONDS)


@pytest.fixture(scope="session")
def synthetic_media(tmp_path_factory: pytest.TempPathFactory) -> SyntheticMedia:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg/ffprobe are required for the test suite")
    return _generate_media(tmp_path_factory.mktemp("media"))


@pytest.fixture
def settings() -> Settings:
    return Settings(
        allowed_origins=("http://localhost:5173",),
        frontend_origin="http://localhost:5173",
        max_concurrent_streams=2,
        js_runtime=None,
        pot_provider_url=None,
        cache_ttl_s=600,
        cache_max_entries=10,
    )


@pytest.fixture
def extractor(synthetic_media: SyntheticMedia) -> FakeExtractor:
    return FakeExtractor(synthetic_media)


@pytest.fixture
def app(settings: Settings, extractor: FakeExtractor) -> FastAPI:
    return create_app(settings=settings, extractor=extractor)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture
def ffprobe_json() -> Callable[[bytes, str], dict[str, Any]]:
    def probe(data: bytes, suffix: str = ".bin") -> dict[str, Any]:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
            fh.write(data)
            path = fh.name
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            ).stdout
        finally:
            Path(path).unlink(missing_ok=True)
        return json.loads(out)

    return probe
