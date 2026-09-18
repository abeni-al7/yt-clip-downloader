"""ffprobe helpers: the keyframe at or before a position, and the encoders this ffmpeg offers."""

import asyncio
import functools
import logging
import shutil
import subprocess
from typing import Any

from ytclip.domain.format_plan import header_blob

log = logging.getLogger(__name__)

PROBE_TIMEOUT_S = 20


async def keyframe_at_or_before(video_format: dict[str, Any], start_s: int) -> float | None:
    """Position of the keyframe ffmpeg will seek to for `start_s`, or None if it cannot be probed.

    Seeking both video and audio inputs to this position keeps them aligned and lets the audio
    cover the lead-in that stream-copy cutting inevitably includes (FR-014).
    """
    url = str(video_format["url"])
    argv = ["ffprobe", "-v", "error"]
    if url.startswith(("http://", "https://")):
        headers = header_blob(video_format.get("http_headers") or {})
        if headers:
            argv += ["-headers", headers]
    argv += [
        "-select_streams", "v:0",
        "-read_intervals", f"{start_s}%+#1",
        "-show_entries", "packet=pts_time",
        "-of", "csv=p=0",
        url,
    ]  # fmt: skip
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), PROBE_TIMEOUT_S)
        except TimeoutError:
            process.kill()
            await process.wait()
            log.warning("keyframe probe timed out; seeking to the requested start instead")
            return None
    except OSError as exc:
        log.warning("keyframe probe could not run: %s", exc)
        return None
    if process.returncode != 0:
        log.warning(
            "keyframe probe failed (rc=%s): %s",
            process.returncode,
            stderr.decode(errors="replace")[-500:],
        )
        return None
    first_line = stdout.decode(errors="replace").strip().splitlines()
    try:
        position = float(first_line[0].split(",")[0])
    except (IndexError, ValueError):
        return None
    if position < 0 or position > start_s:
        return None
    return position


@functools.lru_cache(maxsize=1)
def available_encoders() -> frozenset[str]:
    path = shutil.which("ffmpeg")
    if not path:
        return frozenset()
    try:
        out = subprocess.run(
            [path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return frozenset()
    names = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] and parts[0][0] in "VAS" and "." in parts[0]:
            names.add(parts[1])
    return frozenset(names)
