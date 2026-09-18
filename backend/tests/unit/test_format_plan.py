import pytest

from ytclip.domain.format_plan import Sources, build_plan, header_blob, select_sources
from ytclip.domain.models import ClipParams, ErrorCode, OutputFormat
from ytclip.errors import ApiError

VID = "dQw4w9WgXcQ"


def _fmt(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "format_id": "x",
        "url": "https://rr1.googlevideo.com/videoplayback?a=1",
        "protocol": "https",
        "vcodec": "none",
        "acodec": "none",
        "ext": "mp4",
        "http_headers": {"User-Agent": "ua/1.0", "Accept": "*/*"},
    }
    base.update(overrides)
    return base


INFO = {
    "id": VID,
    "duration": 600,
    "formats": [
        _fmt(format_id="137", vcodec="avc1.640028", height=1080, fps=30, tbr=4000),
        _fmt(format_id="248", vcodec="vp9", height=1080, fps=30, tbr=3000, ext="webm"),
        _fmt(format_id="136", vcodec="avc1.4d401f", height=720, fps=30, tbr=2500),
        _fmt(format_id="313", vcodec="vp9", height=2160, fps=30, tbr=12000, ext="webm"),
        _fmt(format_id="140", acodec="mp4a.40.2", abr=128, ext="m4a"),
        _fmt(format_id="251", acodec="opus", abr=140, ext="webm"),
    ],
}


def params(
    fmt: OutputFormat, height: int | None = None, start: int = 60, end: int = 90
) -> ClipParams:
    return ClipParams(video_id=VID, start_s=start, end_s=end, format=fmt, height=height)


def plan_for(fmt: OutputFormat, height: int | None = None, **kwargs: object):
    p = params(fmt, height)
    return build_plan(select_sources(INFO, p), p, **kwargs)  # type: ignore[arg-type]


def test_mp4_plan_seeks_each_input_and_copies_streams() -> None:
    plan = plan_for(OutputFormat.mp4, 1080)
    argv = plan.argv
    assert argv[0] == "ffmpeg" and argv[-1] == "pipe:1"
    assert argv.count("-i") == 2
    # -ss/-t precede every -i (input-side seeking), reconnect + headers only for http inputs
    for index, token in enumerate(argv):
        if token == "-i":
            preceding = argv[:index]
            assert preceding[-2:] == ["-t", "31"]
            assert "-ss" in preceding and "-reconnect" in preceding and "-headers" in preceding
    assert argv[argv.index("-ss") + 1] == "60"
    assert "-c:v" in argv and argv[argv.index("-c:v") + 1] == "copy"
    assert argv[argv.index("-c:a") + 1] == "copy"
    assert "frag_keyframe+empty_moov+default_base_moof" in argv
    assert argv[argv.index("-f") + 1] == "mp4"
    assert plan.video_format_id == "137" and plan.audio_format_id == "140"
    assert plan.content_type == "video/mp4" and plan.extension == "mp4"


def test_keyframe_seek_moves_both_inputs_and_extends_duration() -> None:
    p = params(OutputFormat.mp4, 1080)
    plan = build_plan(select_sources(INFO, p), p, seek_s=57.5)
    assert plan.argv.count("-ss") == 2
    assert all(plan.argv[i + 1] == "57.5" for i, tok in enumerate(plan.argv) if tok == "-ss")
    assert plan.duration_s == 90 + 1 - 57.5
    # a probe result after the requested start is never used
    plan2 = build_plan(select_sources(INFO, p), p, seek_s=61)
    assert plan2.seek_s == 60


def test_mp4_prefers_h264_at_the_same_height() -> None:
    assert plan_for(OutputFormat.mp4, 1080).video_format_id == "137"


def test_mp4_takes_vp9_when_only_codec_at_height() -> None:
    assert plan_for(OutputFormat.mp4, 2160).video_format_id == "313"


def test_exact_height_never_falls_back_lower() -> None:
    with pytest.raises(ApiError) as excinfo:
        plan_for(OutputFormat.mp4, 480)
    assert excinfo.value.code is ErrorCode.unsupported_resolution
    assert excinfo.value.details == {"field": "height", "available": [2160, 1080, 720]}


def test_video_format_requires_height() -> None:
    with pytest.raises(ApiError) as excinfo:
        plan_for(OutputFormat.mp4, None)
    assert excinfo.value.code is ErrorCode.unsupported_resolution


def test_local_file_inputs_get_no_reconnect_or_headers() -> None:
    info = {"formats": [_fmt(format_id="a", url="/tmp/audio.m4a", acodec="mp4a.40.2", abr=128)]}
    p = params(OutputFormat.m4a)
    argv = build_plan(select_sources(info, p), p).argv
    assert "-reconnect" not in argv and "-headers" not in argv


def test_header_blob_strips_crlf_injection() -> None:
    blob = header_blob({"User-Agent": "ua\r\nX-Injected: 1", "Bad:Key": "v", "Cookie": "a=b"})
    assert blob == "User-Agent: uaX-Injected: 1\r\nCookie: a=b\r\n"


def test_sources_dataclass_is_reused_for_progressive_formats() -> None:
    info = {
        "formats": [
            _fmt(format_id="22", vcodec="avc1.64001F", acodec="mp4a.40.2", height=720, tbr=1200)
        ]
    }
    p = params(OutputFormat.mp4, 720)
    sources = select_sources(info, p)
    assert isinstance(sources, Sources) and sources.audio is sources.video
    argv = build_plan(sources, p).argv
    assert argv.count("-i") == 1 and argv[argv.index("-map") + 1] == "0:v:0"
    assert "0:a:0" in argv
