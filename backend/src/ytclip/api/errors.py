"""Error → HTTP mapping: JSON for API clients, a self-contained HTML page for navigations."""

import html
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, Response

from ytclip.domain.models import ErrorBody, ErrorCode
from ytclip.media.extractor import ExtractionError

ERROR_TABLE: dict[ErrorCode, tuple[int, str]] = {
    ErrorCode.invalid_request: (400, "The request is malformed."),
    ErrorCode.invalid_url: (
        400,
        "Please paste a link to a YouTube video (youtube.com or youtu.be).",
    ),
    ErrorCode.playlist_only: (
        400,
        "That link points to a playlist. Paste a link to a single video.",
    ),
    ErrorCode.invalid_range: (
        400,
        "Choose a valid time range: the start must come before the end, within the video.",
    ),
    ErrorCode.unsupported_format: (400, "That output format is not supported."),
    ErrorCode.unsupported_resolution: (
        400,
        "That resolution is not available for this video and format.",
    ),
    ErrorCode.no_audio_track: (400, "This video has no audio track to extract."),
    ErrorCode.private: (422, "This video is private."),
    ErrorCode.age_restricted: (
        422,
        "This video is age-restricted and requires sign-in on YouTube.",
    ),
    ErrorCode.members_only: (422, "This video is for channel members only."),
    ErrorCode.video_unavailable: (422, "This video is unavailable or has been removed."),
    ErrorCode.live_in_progress: (422, "Only completed videos can be clipped."),
    ErrorCode.drm_protected: (422, "This video is DRM-protected."),
    ErrorCode.geo_blocked: (422, "This video is not available in the server's region."),
    ErrorCode.bot_check: (
        502,
        "YouTube is asking the server to prove it isn't a bot. Please try again later.",
    ),
    ErrorCode.extraction_failed: (502, "The video could not be read from YouTube."),
    ErrorCode.processing_failed: (502, "Cutting the clip failed. Please try again."),
    ErrorCode.busy: (503, "The server is busy with another clip — please retry in a moment."),
}


class ApiError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        retry_after: int | None = None,
    ) -> None:
        self.code = code
        self.status, default_message = ERROR_TABLE[code]
        self.message = message or default_message
        self.details = details
        self.retry_after = retry_after
        super().__init__(self.message)

    def body(self) -> ErrorBody:
        return ErrorBody(code=self.code, message=self.message, details=self.details)


def wants_html(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    html_at = accept.find("text/html")
    if html_at < 0:
        return False
    json_at = accept.find("application/json")
    return json_at < 0 or html_at < json_at


_HTML_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>{refresh}
<style>
  body {{ font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 3rem 1.25rem;
         color: #1f2328; background: #f6f8fa; }}
  main {{ max-width: 34rem; margin: 0 auto; background: #fff; border: 1px solid #d0d7de;
          border-radius: 12px; padding: 1.5rem; }}
  h1 {{ font-size: 1.25rem; margin: 0 0 .5rem; }}
  p {{ margin: .5rem 0; }}
  code {{ background: #eef1f4; padding: .1rem .35rem; border-radius: 4px; }}
  a {{ color: #0969da; }}
</style>
</head>
<body>
<main>
<h1>{title}</h1>
<p>{message}</p>
{extra}
<p><a href="{back}">Back to the app</a></p>
<p><small>Error code: <code>{code}</code></small></p>
</main>
</body>
</html>
"""


def render_html(error: ApiError, frontend_origin: str) -> str:
    title = "The clip could not be produced" if error.status >= 500 else "That request didn't work"
    if error.code is ErrorCode.busy:
        title = "The server is busy"
    refresh = (
        f'\n<meta http-equiv="refresh" content="{error.retry_after or 15}">'
        if error.code is ErrorCode.busy
        else ""
    )
    extra = "<p>This page will retry automatically.</p>" if error.code is ErrorCode.busy else ""
    return _HTML_PAGE.format(
        title=html.escape(title),
        message=html.escape(error.message),
        extra=extra,
        back=html.escape(frontend_origin, quote=True),
        code=html.escape(error.code.value),
        refresh=refresh,
    )


def from_extraction_error(exc: ExtractionError) -> ApiError:
    # Only the generic failure surfaces yt-dlp's own text; known cases use our plain-language copy.
    if exc.code is ErrorCode.extraction_failed and exc.message:
        return ApiError(exc.code, f"The video could not be read from YouTube: {exc.message}")
    return ApiError(exc.code)


def error_response(request: Request, error: ApiError) -> Response:
    headers = {"Cache-Control": "no-store"}
    if error.retry_after is not None:
        headers["Retry-After"] = str(error.retry_after)
    if wants_html(request):
        frontend_origin = request.app.state.settings.frontend_origin
        return HTMLResponse(
            render_html(error, frontend_origin), status_code=error.status, headers=headers
        )
    return JSONResponse(
        error.body().model_dump(mode="json", exclude_none=True),
        status_code=error.status,
        headers=headers,
    )


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> Response:
        return error_response(request, exc)

    @app.exception_handler(ExtractionError)
    async def _extraction_error(request: Request, exc: ExtractionError) -> Response:
        return error_response(request, from_extraction_error(exc))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> Response:
        details = {
            "errors": [
                {
                    "field": ".".join(str(part) for part in err.get("loc", ())),
                    "message": err.get("msg"),
                }
                for err in exc.errors()
            ]
        }
        return error_response(request, ApiError(ErrorCode.invalid_request, details=details))
