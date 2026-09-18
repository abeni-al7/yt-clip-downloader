"""FastAPI application factory. Nothing here persists anything (FR-020)."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ytclip.api import health
from ytclip.api.errors import register_handlers
from ytclip.config import Settings
from ytclip.limits import StreamSlots
from ytclip.media.cache import InfoCache
from ytclip.media.extractor import Extractor, YtDlpExtractor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(settings: Settings | None = None, extractor: Extractor | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(
        title="YouTube Clip Download API",
        version="0.2.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.cache = InfoCache(settings.cache_ttl_s, settings.cache_max_entries)
    app.state.slots = StreamSlots(settings.max_concurrent_streams)
    app.state.extractor = extractor or YtDlpExtractor(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_origin_regex=settings.allowed_origin_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=600,
    )
    register_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
