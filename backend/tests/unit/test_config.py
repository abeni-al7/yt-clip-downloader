import pytest

from ytclip.config import Settings
from ytclip.media.extractor import YtDlpExtractor, _YtDlpLogger, parse_extractor_args


def test_defaults_target_datacenter_friendly_clients_with_po_tokens() -> None:
    s = Settings.from_env({})
    assert s.ytdlp_player_clients == Settings().ytdlp_player_clients
    assert "mweb" in s.ytdlp_player_clients  # the client yt-dlp's wiki recommends with a PO token
    assert s.ytdlp_player_clients[-1] == "visionos"  # the token-free fallback stays last
    assert s.ytdlp_fetch_pot == "always"
    assert s.pot_provider_url == "http://127.0.0.1:4416"
    assert s.js_runtime == "deno"
    assert s.log_level == "INFO"


def test_env_overrides_and_explicit_disables() -> None:
    s = Settings.from_env(
        {
            "YTDLP_PLAYER_CLIENTS": " web_embedded, tv_downgraded ",
            "YTDLP_FETCH_POT": "Auto",
            "POT_PROVIDER_URL": "http://pot:8080/",
            "YTDLP_EXTRACTOR_ARGS": "youtube:player_skip=configs",
            "JS_RUNTIME": "",
            "LOG_LEVEL": "debug",
        }
    )
    assert s.ytdlp_player_clients == ("web_embedded", "tv_downgraded")
    assert s.ytdlp_fetch_pot == "auto"
    assert s.pot_provider_url == "http://pot:8080"
    assert s.ytdlp_extractor_args == "youtube:player_skip=configs"
    assert s.js_runtime is None
    assert s.log_level == "DEBUG"

    disabled = Settings.from_env({"POT_PROVIDER_URL": "", "YTDLP_PLAYER_CLIENTS": ""})
    assert disabled.pot_provider_url is None
    assert disabled.ytdlp_player_clients == ()


def test_invalid_fetch_pot_is_rejected() -> None:
    with pytest.raises(ValueError):
        Settings.from_env({"YTDLP_FETCH_POT": "sometimes"})


def test_parse_extractor_args_mirrors_the_cli_syntax() -> None:
    parsed = parse_extractor_args(
        "youtube:player-client=tv,web;player_skip=configs youtubepot-bgutilhttp:base_url=http://x:1"
    )
    assert parsed == {
        "youtube": {"player_client": ["tv", "web"], "player_skip": ["configs"]},
        "youtubepot-bgutilhttp": {"base_url": ["http://x:1"]},
    }
    with pytest.raises(ValueError):
        parse_extractor_args("no-colon-here")
    with pytest.raises(ValueError):
        parse_extractor_args("youtube:novalue")


def test_extractor_args_compose_clients_pot_policy_and_provider() -> None:
    settings = Settings.from_env({"YTDLP_EXTRACTOR_ARGS": "youtube:player_skip=configs"})
    args = YtDlpExtractor(settings).extractor_args()
    assert args["youtube"] == {
        "fetch_pot": ["always"],
        "player_client": list(Settings().ytdlp_player_clients),
        "player_skip": ["configs"],
    }
    assert args["youtubepot-bgutilhttp"] == {"base_url": ["http://127.0.0.1:4416"]}

    no_provider = YtDlpExtractor(Settings.from_env({"POT_PROVIDER_URL": ""})).extractor_args()
    assert "youtubepot-bgutilhttp" not in no_provider

    yt_defaults = YtDlpExtractor(Settings.from_env({"YTDLP_PLAYER_CLIENTS": ""})).extractor_args()
    assert "player_client" not in yt_defaults["youtube"]


def test_options_pass_extractor_args_and_keep_no_cache() -> None:
    opts = YtDlpExtractor(Settings.from_env({})).options()
    assert opts["extractor_args"]["youtube"]["fetch_pot"] == ["always"]
    assert opts["cachedir"] is False
    assert opts["skip_download"] is True
    # Verbose output feeds the diagnostics allow-list; it only reaches logs at DEBUG level.
    assert opts["verbose"] is True


def test_ytdlp_logger_keeps_a_chronological_operator_trace() -> None:
    logger = _YtDlpLogger()
    logger.debug("[debug] Python 3.12 (CPython x86_64 64bit)")  # noise: dropped
    logger.debug("[youtube] jNQXAC9IVRw: Downloading webpage")
    logger.warning("[youtube] Unable to download webpage: HTTP Error 429: Too Many Requests")
    logger.debug("[debug] [youtube] jNQXAC9IVRw: Retrieved a player PO Token for mweb client")
    logger.debug(
        "[debug] [youtube] jNQXAC9IVRw: mweb player response playability status: LOGIN_REQUIRED"
    )
    logger.debug("[debug] [pot] PO Token response from bgutil:http provider: secret")  # token value
    logger.error(
        "ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot"
    )  # raised anyway

    assert logger.diagnostics == [
        "Downloading webpage",
        "WARNING: Unable to download webpage: HTTP Error 429: Too Many Requests",
        "[youtube] jNQXAC9IVRw: Retrieved a player PO Token for mweb client",
        "[youtube] jNQXAC9IVRw: mweb player response playability status: LOGIN_REQUIRED",
    ]


def test_ytdlp_logger_caps_the_trace() -> None:
    logger = _YtDlpLogger()
    for i in range(100):
        logger.warning(f"warning {i}")
    assert len(logger.diagnostics) == 40
