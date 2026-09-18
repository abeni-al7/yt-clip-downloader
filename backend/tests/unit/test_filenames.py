from ytclip.domain.filenames import content_disposition, download_filename


def test_filename_includes_title_and_range() -> None:
    name = download_filename("My Talk", 60, 90, "mp4")
    assert name == "My Talk [00-01-00-00-01-30].mp4"


def test_filename_sanitises_path_and_control_characters() -> None:
    name = download_filename('A/B: C? "D" <E> | F\nG', 0, 5, "mp3")
    assert "/" not in name and "\n" not in name and '"' not in name
    assert name.endswith(" [00-00-00-00-00-05].mp3")


def test_filename_trims_long_titles_to_120_chars() -> None:
    name = download_filename("x" * 500, 0, 1, "webm")
    title_part = name.split(" [")[0]
    assert len(title_part) == 120


def test_filename_falls_back_when_title_is_empty() -> None:
    assert download_filename("", 0, 1, "m4a") == "clip [00-00-00-00-00-01].m4a"


def test_content_disposition_has_ascii_fallback_and_utf8_name() -> None:
    header = content_disposition("Café – Ünïcode ✓ [00-00-00-00-00-05].opus")
    assert header.startswith('attachment; filename="')
    fallback = header.split('filename="')[1].split('"')[0]
    assert fallback.isascii()
    assert "filename*=UTF-8''Caf%C3%A9" in header


def test_content_disposition_all_non_ascii_title_keeps_extension() -> None:
    header = content_disposition("日本語 [00-00-00-00-00-05].mp4")
    fallback = header.split('filename="')[1].split('"')[0]
    assert fallback.endswith(".mp4") and fallback.isascii() and fallback.strip()
