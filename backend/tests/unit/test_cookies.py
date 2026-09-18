"""prepare_cookies(): the operator's cookies file becomes a private writable copy (research R11)."""

import logging
import stat
import tempfile
from pathlib import Path

import pytest

from ytclip.config import Settings
from ytclip.media.extractor import PreparedCookies, YtDlpExtractor, prepare_cookies

NETSCAPE_HEADER = "# Netscape HTTP Cookie File\n"
FAR_FUTURE = "2000000000"


def cookie_line(name: str, value: str, domain: str = ".youtube.com") -> str:
    return f"{domain}\tTRUE\t/\tTRUE\t{FAR_FUTURE}\t{name}\t{value}\n"


def logged_in_cookies() -> str:
    return NETSCAPE_HEADER + "".join(
        [
            cookie_line("LOGIN_INFO", "AFmmF2s"),
            cookie_line("SAPISID", "abc/def"),
            cookie_line("__Secure-3PAPISID", "abc/def"),
            cookie_line("VISITOR_INFO1_LIVE", "xyz"),
        ]
    )


@pytest.fixture(autouse=True)
def private_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Copies land in the test's tmp dir so the tests can see (and pytest removes) them."""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    return tmp_path


def test_unset_means_no_cookies() -> None:
    assert prepare_cookies(None) is None
    assert prepare_cookies("") is None
    assert YtDlpExtractor(Settings()).cookies is None
    assert "cookiefile" not in YtDlpExtractor(Settings()).options()


def test_read_only_source_is_copied_to_a_private_writable_file(tmp_path: Path) -> None:
    source = tmp_path / "cookies.txt"
    source.write_text(logged_in_cookies())
    source.chmod(0o444)  # Render mounts Secret Files read-only

    prepared = prepare_cookies(str(source))

    assert isinstance(prepared, PreparedCookies)
    assert prepared.logged_in is True
    copy = Path(prepared.path)
    assert copy != source and copy.parent == tmp_path
    assert copy.read_text() == logged_in_cookies()
    assert stat.S_IMODE(copy.stat().st_mode) == 0o600

    # yt-dlp rewrites its cookie file after every run; that must hit the copy, not the secret.
    from yt_dlp.cookies import YoutubeDLCookieJar

    jar = YoutubeDLCookieJar(prepared.path)
    jar.load()
    jar.save()
    assert source.read_text() == logged_in_cookies()


def test_extractor_points_ytdlp_at_the_copy(tmp_path: Path) -> None:
    source = tmp_path / "cookies.txt"
    source.write_text(logged_in_cookies())

    extractor = YtDlpExtractor(Settings(ytdlp_cookies_file=str(source)))

    assert extractor.cookies is not None and extractor.cookies.path != str(source)
    assert extractor.options()["cookiefile"] == extractor.cookies.path


def test_guest_cookies_are_usable_but_not_logged_in(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    source = tmp_path / "cookies.txt"
    source.write_text(NETSCAPE_HEADER + cookie_line("VISITOR_INFO1_LIVE", "xyz"))

    with caplog.at_level(logging.INFO, logger="ytclip"):
        prepared = prepare_cookies(str(source))

    assert prepared is not None and prepared.logged_in is False
    assert "guest session" in caplog.text
    assert "WARNING" not in caplog.text  # a guest session is a supported choice, not a mistake


def test_cookies_from_another_site_are_flagged(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    source = tmp_path / "cookies.txt"
    source.write_text(NETSCAPE_HEADER + cookie_line("session", "abc", domain=".example.com"))

    with caplog.at_level(logging.WARNING, logger="ytclip"):
        prepared = prepare_cookies(str(source))

    assert prepared is not None and prepared.logged_in is False
    assert "exported from youtube.com" in caplog.text


def test_missing_or_malformed_files_are_reported_and_ignored(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    missing = tmp_path / "nope.txt"
    malformed = tmp_path / "cookies.json"
    malformed.write_text('[{"name": "SAPISID", "value": "secret-value"}]')

    with caplog.at_level(logging.ERROR, logger="ytclip"):
        assert prepare_cookies(str(missing)) is None
        assert prepare_cookies(str(malformed)) is None

    assert str(missing) in caplog.text and str(malformed) in caplog.text
    assert "secret-value" not in caplog.text  # never echo cookie contents
    assert not list(tmp_path.glob("ytclip-cookies-*"))  # the rejected copy is removed
