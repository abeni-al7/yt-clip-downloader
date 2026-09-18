#!/bin/sh
# Container entrypoint: optionally start the bgutil PO-token server, then the API.
# The PO-token server lets yt-dlp attest requests so YouTube stops answering datacenter IPs
# with "Sign in to confirm you're not a bot" (research R11). It is loopback-only and in-memory.
set -eu

BGUTIL_HOME="${BGUTIL_HOME:-/opt/bgutil}"
POT_PROVIDER_URL="${POT_PROVIDER_URL-http://127.0.0.1:4416}"

# Start the bundled server only when the configured provider is this container's loopback.
case "$POT_PROVIDER_URL" in
    http://127.0.0.1:*|http://localhost:*) local_provider=1 ;;
    *) local_provider=0 ;;
esac

if [ "$local_provider" = 1 ] && [ -d "$BGUTIL_HOME/src" ] && command -v deno >/dev/null 2>&1; then
    port="${POT_PROVIDER_URL##*:}"
    port="${port%%/*}"
    case "$port" in
        ''|*[!0-9]*) port=4416 ;;
    esac
    echo "starting bgutil PO-token server on 127.0.0.1:${port}"
    (
        cd "$BGUTIL_HOME"
        DENO_DIR="$BGUTIL_HOME/.cache/deno" DENO_NO_PROMPT=1 DENO_NO_UPDATE_CHECK=1 \
        exec deno run --allow-env --allow-net \
            --allow-ffi="$BGUTIL_HOME/node_modules" --allow-read="$BGUTIL_HOME/node_modules" \
            "$BGUTIL_HOME/src/main.ts" --host 127.0.0.1 --port "$port"
    ) &
fi

exec uvicorn ytclip.main:app --host 0.0.0.0 --port "${PORT:-10000}"
