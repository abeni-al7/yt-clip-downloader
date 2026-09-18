"""Timestamp grammar shared with the UI: `SS`, `MM:SS`, `HH:MM:SS`, `[Nh][Nm][Ns]`."""

import re

_DIGITS_RE = re.compile(r"[0-9]+")
_HMS_RE = re.compile(r"(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9]+)s)?")


def parse_timestamp(value: str | int) -> int:
    """Return whole seconds, or raise ValueError for anything outside the grammar."""
    if isinstance(value, bool):
        raise ValueError("a boolean is not a timestamp")
    if isinstance(value, int):
        if value < 0:
            raise ValueError("timestamps cannot be negative")
        return value

    text = str(value).strip().lower()
    if not text:
        raise ValueError("empty timestamp")
    if _DIGITS_RE.fullmatch(text):
        return int(text)

    if ":" in text:
        parts = text.split(":")
        if len(parts) not in (2, 3) or not all(_DIGITS_RE.fullmatch(part) for part in parts):
            raise ValueError(f"unrecognised timestamp: {value!r}")
        numbers = [int(part) for part in parts]
        if len(numbers) == 3:
            hours, minutes, seconds = numbers
            if minutes > 59 or seconds > 59:
                raise ValueError("minutes and seconds must be below 60 in HH:MM:SS")
            return hours * 3600 + minutes * 60 + seconds
        # MM:SS is deliberately lenient: "1:65" means 125 seconds.
        minutes, seconds = numbers
        return minutes * 60 + seconds

    match = _HMS_RE.fullmatch(text)
    if not match or not any(match.groups()):
        raise ValueError(f"unrecognised timestamp: {value!r}")
    hours, minutes, seconds = (int(group) if group else 0 for group in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def _split(seconds: int) -> tuple[int, int, int]:
    seconds = max(0, int(seconds))
    return seconds // 3600, (seconds % 3600) // 60, seconds % 60


def format_hms(seconds: int) -> str:
    hours, minutes, secs = _split(seconds)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def format_hms_for_filename(seconds: int) -> str:
    hours, minutes, secs = _split(seconds)
    return f"{hours:02d}-{minutes:02d}-{secs:02d}"
