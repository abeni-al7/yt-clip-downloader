import dataclasses
import socket
from pathlib import Path

import httpx
from fastapi import FastAPI

from ytclip.config import Settings
from ytclip.main import create_app
from ytclip.media.fakes import FakeExtractor


async def get_health(settings: Settings, extractor: FakeExtractor | None = None) -> dict:
    app: FastAPI = create_app(settings=settings, extractor=extractor)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    return response.json()


async def test_health_reports_dependencies_and_idle_streams(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["status"] in {"ok", "degraded"}
    assert body["yt_dlp_version"]
    assert body["ffmpeg"]["available"] is True
    assert body["streams"] == {"active": 0, "max": 2}
    assert body["js_runtime"] == {"name": None, "available": False}
    # Tests run without the bgutil server: reported, never fatal.
    assert body["pot_provider"] == {"url": None, "available": False, "version": None}
    assert body["cookies"] == {"configured": False, "available": False, "logged_in": False}
    assert body["player_clients"] == list(Settings().ytdlp_player_clients)


async def test_unreachable_configured_pot_provider_degrades_health(
    settings: Settings, extractor: FakeExtractor
) -> None:
    with socket.socket() as probe:  # a loopback port nothing listens on
        probe.bind(("127.0.0.1", 0))
        url = f"http://127.0.0.1:{probe.getsockname()[1]}"

    body = await get_health(dataclasses.replace(settings, pot_provider_url=url), extractor)

    assert body["status"] == "degraded"
    assert body["pot_provider"] == {"url": url, "available": False, "version": None}


async def test_unusable_configured_cookies_file_degrades_health(
    settings: Settings, extractor: FakeExtractor, tmp_path: Path
) -> None:
    # The real extractor prepares the file; the fake stands in for one that found nothing.
    body = await get_health(
        dataclasses.replace(settings, ytdlp_cookies_file=str(tmp_path / "missing.txt")), extractor
    )

    assert body["status"] == "degraded"
    assert body["cookies"] == {"configured": True, "available": False, "logged_in": False}


async def test_logged_in_cookies_file_is_reported_available(
    settings: Settings, tmp_path: Path
) -> None:
    cookies = tmp_path / "cookies.txt"
    cookies.write_text(
        "# Netscape HTTP Cookie File\n"
        ".youtube.com\tTRUE\t/\tTRUE\t2000000000\tLOGIN_INFO\tx\n"
        ".youtube.com\tTRUE\t/\tTRUE\t2000000000\tSAPISID\ty\n"
    )

    body = await get_health(dataclasses.replace(settings, ytdlp_cookies_file=str(cookies)))

    assert body["cookies"] == {"configured": True, "available": True, "logged_in": True}


async def test_cors_preflight_allows_configured_origin(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/videos/resolve",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_cors_preflight_allows_vercel_preview_origins(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/health",
        headers={
            "Origin": "https://yt-clip-abc123.vercel.app",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://yt-clip-abc123.vercel.app"


async def test_unknown_origin_gets_no_cors_headers(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


async def test_validation_errors_use_the_error_schema(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health", params={"x": "y"})  # extra params are ignored
    assert response.status_code == 200
