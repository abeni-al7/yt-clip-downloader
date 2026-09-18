"""Runtime configuration, read once from environment variables."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _optional(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key, "").strip()
    return value or None


def _int(env: Mapping[str, str], key: str, default: int) -> int:
    raw = env.get(key, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True, slots=True)
class Settings:
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)
    allowed_origin_regex: str | None = r"^https://.*\.vercel\.app$"
    frontend_origin: str = "http://localhost:5173"
    max_concurrent_streams: int = 2
    js_runtime: str | None = "deno"
    ytdlp_cookies_file: str | None = None
    ytdlp_proxy: str | None = None
    # Clients that work from datacenter IPs when a PO token is supplied (yt-dlp wiki recommends
    # mweb + PO token); visionos needs neither JS nor a token and is kept as a cheap extra.
    ytdlp_player_clients: tuple[str, ...] = ("mweb", "visionos")
    # "always" also attaches a *player* PO token, which is what clears the bot check.
    ytdlp_fetch_pot: str = "always"
    ytdlp_extractor_args: str | None = None
    pot_provider_url: str | None = "http://127.0.0.1:4416"
    cache_ttl_s: int = 600
    cache_max_entries: int = 50
    log_level: str = "INFO"
    port: int = 10000

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        defaults = cls()
        # An explicitly empty value disables the feature; an unset variable keeps the default.
        if "JS_RUNTIME" in env:
            js_runtime = env["JS_RUNTIME"].strip() or None
        else:
            js_runtime = defaults.js_runtime
        if "YTDLP_PLAYER_CLIENTS" in env:
            player_clients = _csv(env["YTDLP_PLAYER_CLIENTS"])
        else:
            player_clients = defaults.ytdlp_player_clients
        if "POT_PROVIDER_URL" in env:
            pot_provider_url = env["POT_PROVIDER_URL"].strip().rstrip("/") or None
        else:
            pot_provider_url = defaults.pot_provider_url
        fetch_pot = env.get("YTDLP_FETCH_POT", "").strip().lower() or defaults.ytdlp_fetch_pot
        if fetch_pot not in ("never", "auto", "always"):
            raise ValueError(f"YTDLP_FETCH_POT must be never, auto or always (got {fetch_pot!r})")
        return cls(
            allowed_origins=_csv(env.get("ALLOWED_ORIGINS", "")) or defaults.allowed_origins,
            allowed_origin_regex=(
                _optional(env, "ALLOWED_ORIGIN_REGEX")
                if "ALLOWED_ORIGIN_REGEX" in env
                else defaults.allowed_origin_regex
            ),
            frontend_origin=_optional(env, "FRONTEND_ORIGIN") or defaults.frontend_origin,
            max_concurrent_streams=_int(
                env, "MAX_CONCURRENT_STREAMS", defaults.max_concurrent_streams
            ),
            js_runtime=js_runtime,
            ytdlp_cookies_file=_optional(env, "YTDLP_COOKIES_FILE"),
            ytdlp_proxy=_optional(env, "YTDLP_PROXY"),
            ytdlp_player_clients=player_clients,
            ytdlp_fetch_pot=fetch_pot,
            ytdlp_extractor_args=_optional(env, "YTDLP_EXTRACTOR_ARGS"),
            pot_provider_url=pot_provider_url,
            cache_ttl_s=_int(env, "CACHE_TTL_S", defaults.cache_ttl_s),
            cache_max_entries=_int(env, "CACHE_MAX_ENTRIES", defaults.cache_max_entries),
            log_level=(env.get("LOG_LEVEL", "").strip().upper() or defaults.log_level),
            port=_int(env, "PORT", defaults.port),
        )
