"""GET /api/health — dependency check and wake-up probe."""

import functools
import shutil
import subprocess

import httpx
from fastapi import APIRouter, Request, Response

from ytclip.domain.models import (
    CookiesStatus,
    Health,
    PotProviderStatus,
    RuntimeStatus,
    StreamStatus,
    ToolStatus,
)

router = APIRouter(prefix="/api", tags=["system"])


@functools.lru_cache(maxsize=1)
def ffmpeg_status() -> ToolStatus:
    path = shutil.which("ffmpeg")
    if not path:
        return ToolStatus(available=False)
    try:
        out = subprocess.run(
            [path, "-version"], capture_output=True, text=True, timeout=10, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ToolStatus(available=True, version=None)
    first = out.splitlines()[0] if out else ""
    parts = first.split()
    version = parts[2] if len(parts) >= 3 and parts[0] == "ffmpeg" else None
    return ToolStatus(available=True, version=version)


def _rss_mb() -> int | None:
    try:
        with open("/proc/self/status", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


async def pot_provider_status(url: str | None) -> PotProviderStatus:
    """Pings the bgutil PO-token server (research R11); it is optional, so failures are reported."""
    if not url:
        return PotProviderStatus(url=None, available=False)
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{url}/ping")
            response.raise_for_status()
            version = response.json().get("version")
    except (httpx.HTTPError, ValueError):
        return PotProviderStatus(url=url, available=False)
    return PotProviderStatus(url=url, available=True, version=str(version) if version else None)


@router.get("/health", response_model=Health)
async def health(request: Request, response: Response) -> Health:
    import yt_dlp.version

    state = request.app.state
    settings = state.settings
    runtime_name = settings.js_runtime
    runtime = RuntimeStatus(
        name=runtime_name, available=bool(runtime_name and shutil.which(runtime_name))
    )
    ffmpeg = ffmpeg_status()
    pot_provider = await pot_provider_status(settings.pot_provider_url)
    provider_ok = pot_provider.available or settings.pot_provider_url is None
    prepared = state.extractor.cookies
    cookies = CookiesStatus(
        configured=settings.ytdlp_cookies_file is not None,
        available=prepared is not None,
        logged_in=prepared is not None and prepared.logged_in,
    )
    cookies_ok = cookies.available or not cookies.configured
    response.headers["Cache-Control"] = "no-store"
    healthy = ffmpeg.available and runtime.available and provider_ok and cookies_ok
    return Health(
        status="ok" if healthy else "degraded",
        yt_dlp_version=yt_dlp.version.__version__,
        ffmpeg=ffmpeg,
        js_runtime=runtime,
        pot_provider=pot_provider,
        cookies=cookies,
        player_clients=list(settings.ytdlp_player_clients),
        streams=StreamStatus(active=state.slots.active, max=state.slots.max),
        rss_mb=_rss_mb(),
    )
