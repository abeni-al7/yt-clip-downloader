"""GET /api/clip — cut the requested segment with ffmpeg and stream it as a file download.

Nothing is written to disk; the response body is produced while it is sent (FR-016, FR-020).
"""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response, StreamingResponse
from starlette.requests import ClientDisconnect
from starlette.types import Receive, Scope, Send

from ytclip.domain.filenames import content_disposition, download_filename
from ytclip.domain.format_plan import build_plan, select_sources
from ytclip.domain.models import ClipParams, ErrorCode, OutputFormat
from ytclip.domain.timestamps import format_hms, parse_timestamp
from ytclip.domain.youtube_url import parse_youtube_url
from ytclip.errors import ApiError
from ytclip.media.extractor import resolve_info
from ytclip.media.probe import available_encoders, keyframe_at_or_before
from ytclip.media.streamer import FfmpegStream, ProcessingFailed

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["clip"])


class FfmpegStreamingResponse(StreamingResponse):
    """StreamingResponse that always reaps ffmpeg and frees the stream slot, even on disconnect."""

    def __init__(
        self,
        stream: FfmpegStream,
        *,
        on_close: Callable[[], None],
        label: str,
        **kwargs: object,
    ) -> None:
        super().__init__(stream.chunks(), **kwargs)  # type: ignore[arg-type]
        self._stream = stream
        self._on_close = on_close
        self._label = label

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        outcome = "completed"
        try:
            await super().__call__(scope, receive, send)
        except (ClientDisconnect, OSError, asyncio.CancelledError):
            outcome = "client_disconnected"
            raise
        except BaseException:
            outcome = "failed"
            raise
        finally:
            await self._stream.close()
            self._on_close()
            if outcome == "completed" and self._stream.returncode not in (0, None):
                outcome = "failed"
            log.info(
                "clip %s outcome=%s bytes_sent=%d elapsed_s=%.1f ffmpeg_rc=%s",
                self._label,
                outcome,
                self._stream.bytes_sent,
                time.monotonic() - self._stream.started_at,
                self._stream.returncode,
            )
            if outcome == "failed" and self._stream.stderr_tail:
                log.warning("clip %s ffmpeg stderr: %s", self._label, self._stream.stderr_tail)


def _parse_time(field: str, raw: str) -> int:
    try:
        return parse_timestamp(raw)
    except ValueError as exc:
        raise ApiError(
            ErrorCode.invalid_range,
            f"Could not read the {field} time. Use HH:MM:SS, MM:SS, or seconds.",
            details={"field": field},
        ) from exc


@router.get("/clip", response_class=Response)
async def download_clip(
    request: Request,
    v: Annotated[str, Query(min_length=1, max_length=2048)],
    start: Annotated[str, Query(min_length=1, max_length=32)],
    end: Annotated[str, Query(min_length=1, max_length=32)],
    output_format: Annotated[str, Query(alias="format", min_length=1, max_length=16)],
    height: Annotated[int | None, Query(ge=1, le=8640)] = None,
) -> Response:
    parsed = parse_youtube_url(v)
    start_s = _parse_time("start", start)
    end_s = _parse_time("end", end)
    try:
        fmt = OutputFormat(output_format.lower())
    except ValueError as exc:
        raise ApiError(
            ErrorCode.unsupported_format,
            details={"field": "format", "supported": [item.value for item in OutputFormat]},
        ) from exc
    if end_s - start_s < 1:
        raise ApiError(
            ErrorCode.invalid_range, "End must be after start.", details={"field": "end"}
        )
    if fmt.is_video and height is None:
        raise ApiError(
            ErrorCode.unsupported_resolution,
            "Choose a resolution for video formats.",
            details={"field": "height"},
        )
    if not fmt.is_video and height is not None:
        raise ApiError(
            ErrorCode.unsupported_resolution,
            "Audio formats do not take a resolution.",
            details={"field": "height"},
        )

    state = request.app.state
    state.slots.acquire()
    try:
        info = await resolve_info(state.cache, state.extractor, parsed.video_id)
        duration_s = int(round(float(info.get("duration") or 0)))
        if end_s > duration_s:
            raise ApiError(
                ErrorCode.invalid_range,
                f"End must be within the video ({format_hms(duration_s)}).",
                details={"field": "end", "max": duration_s},
            )
        params = ClipParams(
            video_id=parsed.video_id, start_s=start_s, end_s=end_s, format=fmt, height=height
        )
        # Every URL handed to ffprobe/ffmpeg comes from the extractor's info dict; the only
        # user-controlled input that reaches the network is the 11-character video id (SSRF).
        sources = select_sources(info, params)
        seek_s = None
        if sources.video is not None and sources.audio is not sources.video:
            # Seek both inputs to the keyframe so the audio covers the video lead-in (FR-014).
            seek_s = await keyframe_at_or_before(sources.video, start_s)
        plan = build_plan(sources, params, seek_s=seek_s, encoders=available_encoders())
        label = f"{parsed.video_id} {start_s}-{end_s} {fmt.value} {height or '-'}"
        stream = FfmpegStream(plan.argv)
        try:
            await stream.start()
        except ProcessingFailed as exc:
            # ffmpeg's stderr can contain signed media URLs, so it is logged, never returned.
            log.error(
                "clip %s ffmpeg failed before first byte (rc=%s): %s",
                label,
                exc.returncode,
                exc.stderr_tail,
            )
            raise ApiError(ErrorCode.processing_failed) from exc
    except BaseException:
        state.slots.release()
        raise

    filename = download_filename(str(info.get("title") or ""), start_s, end_s, plan.extension)
    headers = {
        "Content-Disposition": content_disposition(filename),
        "Cache-Control": "no-store",
        "X-Clip-Start-Requested": str(start_s),
        "X-Clip-End-Requested": str(end_s),
    }
    return FfmpegStreamingResponse(
        stream,
        on_close=state.slots.release,
        label=label,
        media_type=plan.content_type,
        headers=headers,
    )
