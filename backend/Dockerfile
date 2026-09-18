# syntax=docker/dockerfile:1
# Pinned together: the bgutil server image below was built for this Deno release.
ARG DENO_VERSION=2.9.5
ARG BGUTIL_VERSION=2.0.0

FROM denoland/deno:bin-${DENO_VERSION} AS deno
FROM brainicism/bgutil-ytdlp-pot-provider:${BGUTIL_VERSION}-deno AS bgutil

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PORT=10000 \
    JS_RUNTIME=deno \
    POT_PROVIDER_URL=http://127.0.0.1:4416 \
    BGUTIL_HOME=/opt/bgutil

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 app

# yt-dlp needs a JavaScript runtime for full YouTube support; Deno is the recommended one.
COPY --from=deno /deno /usr/local/bin/deno
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Prebuilt bgutil PO-token server (sources, node_modules with native canvas, warm Deno cache).
COPY --from=bgutil --chown=10001:10001 /app /opt/bgutil

WORKDIR /app

# Dependency layer first so source changes do not invalidate it.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY start.sh ./start.sh
RUN uv sync --frozen --no-dev && chmod +x ./start.sh && chown -R app:app /app
USER app

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 10000
CMD ["./start.sh"]
