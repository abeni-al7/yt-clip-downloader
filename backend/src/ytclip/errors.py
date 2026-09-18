"""Application error type and the ErrorCode → (HTTP status, user message) table. Framework-free."""

from typing import Any

from ytclip.domain.models import ErrorBody, ErrorCode

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
