"""Download file naming (research R14)."""

from pathlib import PurePosixPath
from urllib.parse import quote

from yt_dlp.utils import sanitize_filename

from ytclip.domain.timestamps import format_hms_for_filename

MAX_TITLE_CHARS = 120


def download_filename(title: str, start_s: int, end_s: int, extension: str) -> str:
    base = sanitize_filename((title or "").strip(), restricted=False).strip() or "clip"
    base = base[:MAX_TITLE_CHARS].rstrip(" .") or "clip"
    window = f"{format_hms_for_filename(start_s)}-{format_hms_for_filename(end_s)}"
    return f"{base} [{window}].{extension}"


def content_disposition(filename: str) -> str:
    """RFC 6266: ASCII fallback in `filename=`, full Unicode name in `filename*=`."""
    fallback = filename.encode("ascii", "ignore").decode("ascii")
    fallback = " ".join(fallback.replace('"', "").replace("\\", "").split())
    if not fallback or fallback.startswith("."):
        fallback = f"clip{PurePosixPath(filename).suffix}"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"
