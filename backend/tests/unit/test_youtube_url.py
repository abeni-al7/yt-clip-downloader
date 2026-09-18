import pytest

from ytclip.domain.models import ErrorCode
from ytclip.domain.youtube_url import canonical_url, parse_youtube_url
from ytclip.errors import ApiError

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VID}",
        f"http://youtube.com/watch?v={VID}",
        f"youtube.com/watch?v={VID}",
        f"https://m.youtube.com/watch?v={VID}&feature=share",
        f"https://music.youtube.com/watch?v={VID}&list=RDAMVM123",
        f"https://youtu.be/{VID}",
        f"youtu.be/{VID}?si=abcdef",
        f"https://www.youtube.com/shorts/{VID}",
        f"https://www.youtube.com/live/{VID}?feature=share",
        f"https://www.youtube.com/embed/{VID}",
        f"https://www.youtube-nocookie.com/embed/{VID}",
        f"https://www.youtube.com/v/{VID}",
        f"https://www.youtube.com/watch?v={VID}&list=PLxyz&index=3",
        f"  https://www.youtube.com/watch?v={VID}  ",
        VID,
    ],
)
def test_accepted_shapes_yield_the_video_id(url: str) -> None:
    assert parse_youtube_url(url).video_id == VID


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (f"https://youtu.be/{VID}?t=90", 90),
        (f"https://www.youtube.com/watch?v={VID}&t=90s", 90),
        (f"https://www.youtube.com/watch?v={VID}&t=1m30s", 90),
        (f"https://www.youtube.com/watch?v={VID}&t=1h2m3s", 3723),
        (f"https://www.youtube.com/watch?v={VID}&start=45", 45),
        (f"https://www.youtube.com/watch?v={VID}#t=75", 75),
        (f"https://www.youtube.com/watch?v={VID}", None),
        (f"https://www.youtube.com/watch?v={VID}&t=bogus", None),
    ],
)
def test_start_hint(url: str, expected: int | None) -> None:
    assert parse_youtube_url(url).start_hint_s == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=" + VID,
        "https://vimeo.com/12345",
        "https://www.youtube.com/@somechannel",
        "https://www.youtube.com/watch?v=tooshort",
        "https://www.youtube.com/watch",
        "not a url at all",
        "",
        "https://www.youtube.com/results?search_query=cats",
    ],
)
def test_garbage_is_invalid_url(url: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        parse_youtube_url(url)
    assert excinfo.value.code is ErrorCode.invalid_url


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/playlist?list=PLxyz",
        "https://www.youtube.com/watch?list=PLxyz",
    ],
)
def test_playlist_only_links(url: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        parse_youtube_url(url)
    assert excinfo.value.code is ErrorCode.playlist_only


def test_canonical_url() -> None:
    assert canonical_url(VID) == f"https://www.youtube.com/watch?v={VID}"
    with pytest.raises(ValueError):
        canonical_url("nope")
