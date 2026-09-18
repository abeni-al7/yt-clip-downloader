"""GET /api/health — dependency check and wake-up probe."""

import functools
import shutil
import subprocess

from fastapi import APIRouter, Request, Response

from ytclip.domain.models import Health, RuntimeStatus, StreamStatus, ToolStatus

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


@router.get("/health", response_model=Health)
async def health(request: Request, response: Response) -> Health:
    import yt_dlp.version

    state = request.app.state
    runtime_name = state.settings.js_runtime
    runtime = RuntimeStatus(
        name=runtime_name, available=bool(runtime_name and shutil.which(runtime_name))
    )
    ffmpeg = ffmpeg_status()
    response.headers["Cache-Control"] = "no-store"
    return Health(
        status="ok" if ffmpeg.available and runtime.available else "degraded",
        yt_dlp_version=yt_dlp.version.__version__,
        ffmpeg=ffmpeg,
        js_runtime=runtime,
        streams=StreamStatus(active=state.slots.active, max=state.slots.max),
        rss_mb=_rss_mb(),
    )
