"""Error → HTTP mapping: JSON for API clients, a self-contained HTML page for navigations."""

import html

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, Response

from ytclip.domain.models import ErrorCode
from ytclip.errors import ERROR_TABLE, ApiError
from ytclip.media.extractor import ExtractionError

__all__ = ["ERROR_TABLE", "ApiError", "error_response", "register_handlers", "wants_html"]


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
