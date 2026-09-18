import pytest

from ytclip.domain.models import ErrorCode
from ytclip.errors import ERROR_TABLE, ApiError
from ytclip.media.extractor import (
    ExtractionError,
    check_availability,
    classify_error,
    trim_ytdlp_message,
)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot.", ErrorCode.bot_check),
        (
            "All player responses are invalid. Your IP is likely being blocked by Youtube",
            ErrorCode.bot_check,
        ),
        (
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
            ErrorCode.private,
        ),
        ("Sign in to confirm your age", ErrorCode.age_restricted),
        ("This video may be inappropriate for some users.", ErrorCode.age_restricted),
        ("Join this channel to get access to members-only content", ErrorCode.members_only),
        ("ERROR: [youtube] abc: Video unavailable", ErrorCode.video_unavailable),
        ("This video has been removed by the uploader", ErrorCode.video_unavailable),
        ("The uploader has not made this video available in your country", ErrorCode.geo_blocked),
        ("This video is DRM protected", ErrorCode.drm_protected),
        ("This live event will begin in 3 hours.", ErrorCode.live_in_progress),
        ("Something completely different went wrong", ErrorCode.extraction_failed),
    ],
)
def test_classify_error(message: str, expected: ErrorCode) -> None:
    assert classify_error(Exception(message)) is expected


def test_trim_ytdlp_message_strips_prefixes_and_truncates() -> None:
    assert (
        trim_ytdlp_message("ERROR: [youtube] dQw4w9WgXcQ: Video unavailable\nmore")
        == "Video unavailable"
    )
    assert len(trim_ytdlp_message("x" * 500)) == 200


def test_error_table_covers_every_code() -> None:
    assert set(ERROR_TABLE) == set(ErrorCode)
    for code, (status, message) in ERROR_TABLE.items():
        assert status in {400, 422, 502, 503}, code
        assert message.endswith(".")


def test_api_error_defaults_from_table() -> None:
    err = ApiError(ErrorCode.busy, retry_after=15)
    assert err.status == 503 and err.retry_after == 15
    assert err.body().message == ERROR_TABLE[ErrorCode.busy][1]
    custom = ApiError(ErrorCode.invalid_range, "End must be after start.", details={"field": "end"})
    assert custom.message == "End must be after start." and custom.details == {"field": "end"}


def test_check_availability_rejects_live_drm_and_empty() -> None:
    with pytest.raises(ExtractionError) as live:
        check_availability({"live_status": "is_live", "formats": [{"url": "x"}], "duration": 1})
    assert live.value.code is ErrorCode.live_in_progress
    with pytest.raises(ExtractionError) as drm:
        check_availability({"formats": [{"url": "x", "has_drm": True}], "duration": 10})
    assert drm.value.code is ErrorCode.drm_protected
    with pytest.raises(ExtractionError) as empty:
        check_availability({"formats": [], "duration": 10})
    assert empty.value.code is ErrorCode.video_unavailable
    check_availability({"live_status": "not_live", "formats": [{"url": "x"}], "duration": 10})
