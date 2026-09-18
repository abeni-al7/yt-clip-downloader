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
    cache_ttl_s: int = 600
    cache_max_entries: int = 50
    port: int = 10000

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        defaults = cls()
        # JS_RUNTIME="" explicitly disables the JavaScript runtime; unset keeps the default.
        if "JS_RUNTIME" in env:
            js_runtime = env["JS_RUNTIME"].strip() or None
        else:
            js_runtime = defaults.js_runtime
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
            cache_ttl_s=_int(env, "CACHE_TTL_S", defaults.cache_ttl_s),
            cache_max_entries=_int(env, "CACHE_MAX_ENTRIES", defaults.cache_max_entries),
            port=_int(env, "PORT", defaults.port),
        )
