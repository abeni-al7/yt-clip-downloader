import pytest

from ytclip.domain.timestamps import format_hms, format_hms_for_filename, parse_timestamp


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("65", 65),
        (65, 65),
        ("0", 0),
        ("1:05", 65),
        ("1:65", 125),
        ("00:01:00", 60),
        ("01:00:00", 3600),
        ("1:2:3", 3723),
        ("1h5m", 3900),
        ("90s", 90),
        ("2h", 7200),
        ("1h2m3s", 3723),
        (" 1:05 ", 65),
        ("1H5M", 3900),
    ],
)
def test_parse_timestamp(value: str | int, expected: int) -> None:
    assert parse_timestamp(value) == expected


@pytest.mark.parametrize(
    "value",
    ["", "abc", "1:2:3:4", "1:60:00", "1:00:60", "-5", -5, "1.5", "1h5", "h", "1:", ":30", True],
)
def test_parse_timestamp_rejects(value: object) -> None:
    with pytest.raises(ValueError):
        parse_timestamp(value)  # type: ignore[arg-type]


def test_format_hms() -> None:
    assert format_hms(0) == "00:00:00"
    assert format_hms(65) == "00:01:05"
    assert format_hms(3723) == "01:02:03"
    assert format_hms(36000) == "10:00:00"
    assert format_hms_for_filename(3723) == "01-02-03"
