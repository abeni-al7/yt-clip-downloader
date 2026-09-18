import httpx


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
