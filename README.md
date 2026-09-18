# YouTube Clip Download

Paste a YouTube link, choose the part you want, pick a format and quality, and download **just that segment** — without downloading the whole video first.

- No account, no sign-in, no quotas, no clip-length limit.
- **Nothing is stored anywhere.** The clip is cut with ffmpeg *while* it streams to your browser and is gone the moment the download ends.
- Six formats: MP4, WebM (video with sound) · MP3, M4A, OGG, Opus (audio only).
- Original quality — video is never re-encoded. Cuts snap outward to the nearest keyframe, so a clip may include a few extra seconds at the start or end.
- Designed for a single user on free hosting: backend on **Render Free**, frontend on **Vercel Hobby**.

> **Legal**: you are responsible for complying with YouTube's Terms of Service and applicable copyright law. Use it for content you have the right to download.

---

## Table of contents

1. [How it works](#how-it-works)
2. [Repository layout](#repository-layout)
3. [Prerequisites](#prerequisites)
4. [Run locally](#run-locally)
5. [Run with Docker](#run-with-docker)
6. [Tests and quality gates](#tests-and-quality-gates)
7. [Deploy the backend to Render (free)](#deploy-the-backend-to-render-free)
8. [Deploy the frontend to Vercel (free)](#deploy-the-frontend-to-vercel-free)
9. [Connect the two and verify](#connect-the-two-and-verify)
10. [Configuration reference](#configuration-reference)
11. [Free-tier realities](#free-tier-realities)
12. [Troubleshooting](#troubleshooting)
13. [API](#api)
14. [Design documents](#design-documents)

---

## How it works

```text
Browser (Vercel, static)                 API (Render, Docker)                      YouTube
─────────────────────────                ────────────────────────                  ───────
1. paste link ──POST /api/videos/resolve──▶ yt-dlp extract_info (metadata only) ──▶ player API
   ◀── title, duration, resolutions ──────
2. pick range / format / quality
3. click Download ── GET /api/clip?… ────▶ ffprobe: keyframe at/before start ─────▶ Range request
   (opens in a new tab)                    ffmpeg  -ss <keyframe> -t <len> -i <video url>
                                                   -ss <keyframe> -t <len> -i <audio url>
                                                   -c copy … -f mp4 pipe:1     ◀────── Range requests
   ◀── file streams as it is produced ──── stdout piped straight into the HTTP response
```

- **yt-dlp** is used only to *describe* the video and obtain the direct stream URLs (with the right headers). It never downloads.
- **ffmpeg** reads only the byte ranges it needs (input-side `-ss`/`-t` on HTTPS inputs), copies the streams (no re-encode) and writes to a pipe. MP4/M4A are written as fragmented MP4 because a pipe cannot be seeked; WebM gets the correct duration header; MP3 is constant-bitrate so players show the right length.
- Both inputs are seeked to the **same keyframe** (found with a tiny `ffprobe` probe), so audio and video stay aligned and the audio covers the lead-in.
- Audio is transcoded only when the container cannot carry the source codec, or for MP3/OGG, which YouTube does not serve. Video is never transcoded.
- The response headers are sent only after ffmpeg produced its first bytes, so validation and extraction errors still arrive as proper status codes with a plain-language message (JSON for API clients, a small HTML page for browser tabs).
- If the browser cancels the download, the server kills ffmpeg immediately.

## Repository layout

```text
backend/     FastAPI service (Python 3.12, uv). Dockerfile installs ffmpeg + Deno.
  src/ytclip/
    api/       resolve, clip (streaming), health, error negotiation
    domain/    URL canonicalisation, timestamp grammar, format inventory, ffmpeg plan, file names
    media/     yt-dlp extractor + error classification, ffmpeg streamer, keyframe probe, in-memory cache
  tests/       unit + integration (offline: synthetic media generated with ffmpeg) + opt-in live tests
frontend/    Vite + React 19 + TypeScript single page. vercel.json rewrites everything to index.html.
render.yaml  Render Blueprint for the API (one free Docker web service)
specs/       Spec Kit artifacts: spec, plan, research, data model, contracts, quickstart, tasks
```

## Prerequisites

| Tool | Version | Needed for |
|------|---------|-----------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 | Python environment and lockfile (it downloads Python 3.12 for you) |
| Node.js | ≥ 20 (22 recommended) | frontend build; also usable as yt-dlp's JS runtime in development |
| ffmpeg + ffprobe | ≥ 6 (7/8 recommended) | cutting, muxing, audio transcode, tests |
| Deno *(optional locally)* | latest | yt-dlp's recommended JS runtime; the Docker image installs it. Locally you can use Node instead (`JS_RUNTIME=node`) |
| Docker *(optional)* | any current | build/run the exact image Render runs |
| Accounts | — | GitHub, [Render](https://render.com) (Hobby workspace), [Vercel](https://vercel.com) (Hobby) |

Check your machine:

```bash
uv --version && node --version && ffmpeg -version | head -1 && ffprobe -version | head -1
```

yt-dlp needs **ffmpeg with libx264/libvpx/libmp3lame/libopus** (the standard Debian/Ubuntu/Homebrew builds have them). `libvorbis` is optional — the server falls back to ffmpeg's built-in Vorbis encoder for OGG.

## Run locally

Two terminals.

**Backend** (http://localhost:8000):

```bash
cd backend
uv sync                                  # creates .venv, installs fastapi, yt-dlp[default], dev tools
export ALLOWED_ORIGINS=http://localhost:5173
export FRONTEND_ORIGIN=http://localhost:5173
export JS_RUNTIME=node                   # use "deno" if you have Deno installed; omit to default to deno
export POT_PROVIDER_URL=                 # no PO-token server locally (only the Docker image bundles one)
export YTDLP_PLAYER_CLIENTS=             # residential IP: yt-dlp's default clients are fine
uv run uvicorn ytclip.main:app --reload --port 8000
```

**Frontend** (http://localhost:5173):

```bash
cd frontend
npm install
cp .env.example .env.local               # VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

Open http://localhost:5173, paste a public YouTube link, choose a range, click **Download**. The download opens in a new tab; keep the browser open until it finishes.

Sanity check without the UI:

```bash
curl -s localhost:8000/api/health | jq
curl -s localhost:8000/api/videos/resolve -H 'content-type: application/json' \
     -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}' | jq '{title, duration_s, resolutions}'
curl -OJ "localhost:8000/api/clip?v=jNQXAC9IVRw&start=2&end=12&format=mp4&height=240"
```

## Run with Docker

This is the exact image Render builds.

```bash
docker build -t ytclip backend
docker run --rm -p 8000:10000 \
  -e ALLOWED_ORIGINS=http://localhost:5173 -e FRONTEND_ORIGIN=http://localhost:5173 \
  ytclip
curl -s localhost:8000/api/health | jq          # js_runtime.name "deno" and pot_provider.available true
```

The container listens on `$PORT` (default `10000`, Render's default), runs as a non-root user, and writes no media to disk. You can prove the last point: after a download, `docker diff <container>` lists only Deno's small compilation caches (`/home/app/.cache/deno` from yt-dlp's JS-challenge solver, `/opt/bgutil/.cache/deno` from the token server) — never a media file. `start.sh` runs two processes: the bgutil PO-token server on loopback port 4416 and uvicorn.

## Tests and quality gates

```bash
# backend: lint, format check, unit + integration tests (offline — ffmpeg generates synthetic media)
cd backend
uv run ruff check . && uv run ruff format --check .
uv run pytest                                   # ~40 s; the first run generates fixtures

# backend: opt-in live test against a real public YouTube video
YTCLIP_LIVE=1 JS_RUNTIME=node uv run pytest tests/live -m live

# frontend: lint, type-check, unit/component tests, production build
cd frontend
npm run lint && npx tsc -b && npm test && npm run build
```

Integration tests drive the real `GET /api/clip` streaming path with a fake extractor pointing at locally generated media, then assert with `ffprobe` (codecs, heights, durations within `[requested, requested + 10 s]`, aligned stream start times, ffmpeg reaped on client disconnect).

---

## Deploy the backend to Render (free)

The repository contains a Blueprint, [render.yaml](render.yaml), describing one **Docker web service on the Free plan**. Render's native Python runtime is not an option because ffmpeg and Deno cannot be installed there.

1. **Push** this repository to GitHub (or GitLab/Bitbucket).
2. In the [Render Dashboard](https://dashboard.render.com) click **New → Blueprint**, connect your Git provider if needed, and select the repository. Render reads `render.yaml`.
3. Render asks for the two variables marked `sync: false`. You may not know the Vercel URL yet — enter placeholders and change them later:
   - `ALLOWED_ORIGINS` → e.g. `http://localhost:5173` for now
   - `FRONTEND_ORIGIN` → same
4. Click **Apply**. The first build takes 5–8 minutes (apt installs ffmpeg, uv installs Python deps). Later builds reuse cached layers.
5. When the deploy is live, note the service URL: `https://<service-name>.onrender.com`.
6. Verify:

   ```bash
   API=https://<service-name>.onrender.com
   curl -s $API/api/health | jq
   # expect: "status":"ok", ffmpeg.available true, js_runtime {"name":"deno","available":true},
   #         pot_provider {"available":true,"version":"2.0.0"},
   #         cookies {"configured":false,...}, player_clients ["web_embedded","tv_downgraded","mweb","visionos"]
   ```

7. **Bot-check go/no-go**:

   ```bash
   curl -s $API/api/videos/resolve -H 'content-type: application/json' \
        -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}' | jq '{title, duration_s}'
   ```

   If this returns `"code": "bot_check"` — **expected on Render**, see the next section — add a cookies file. If it returns the title, you are done with the backend.

### Clear YouTube's bot check with a cookies file

YouTube answers requests from cloud IP ranges such as Render's with *"Sign in to confirm you're not a bot"* (`LOGIN_REQUIRED`). The image already attaches PO tokens (see [Troubleshooting](#youtube-says-bot_check)); on Render's IPs that was **not** enough in our tests — the only thing yt-dlp offers that clears it is a **logged-in YouTube session (cookies)**. This takes about five minutes and needs no rebuild.

> **Use a throwaway Google account.** yt-dlp's wiki warns that YouTube may temporarily or permanently restrict an account used this way. Never use your main account. The account needs no subscriptions — logged in is enough.

1. **Export the cookies** so that the browser never rotates them (yt-dlp's [recommended procedure](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)):
   1. Open a **private/incognito window**, go to `https://www.youtube.com` and log in with the throwaway account.
   2. In the *same tab*, navigate to `https://www.youtube.com/robots.txt` (keep this the only private tab).
   3. Export the `youtube.com` cookies in **Netscape format** with a browser extension such as *Get cookies.txt LOCALLY* (Chrome/Edge) or *cookies.txt* (Firefox). The file starts with `# Netscape HTTP Cookie File` and contains lines for `LOGIN_INFO`, `SAPISID`, `__Secure-3PAPISID`, ….
   4. **Close the private window** and do not log into that account in a browser again — every login rotates the cookies and invalidates the file.
2. **Upload it to Render**: Dashboard → your service → **Environment** → **Secret Files** → **Add Secret File**. Filename `cookies.txt`, paste the file's contents, **Save Changes**. Render mounts it read-only at `/etc/secrets/cookies.txt` (the image's user is in the group Render grants access to).
3. **Tell the API where it is**: same page, **Environment Variables** → add `YTDLP_COOKIES_FILE` = `/etc/secrets/cookies.txt` → **Save and deploy** (no rebuild needed; a restart is enough).
4. **Verify**:

   ```bash
   curl -s $API/api/health | jq .cookies
   # {"configured": true, "available": true, "logged_in": true}
   curl -s $API/api/videos/resolve -H 'content-type: application/json' \
        -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}' | jq '{title, duration_s}'
   ```

   `available: false` → the path is wrong or the file is not Netscape format (see [Troubleshooting](#cookiesavailable-false-or-logged_in-false-in-apihealth)). `logged_in: false` → the export happened while not logged in.

What happens with the file: at startup the API copies it to a private `0600` file in the container's `/tmp` (yt-dlp rewrites the file when YouTube rotates session cookies, and the mounted secret is read-only), passes it only to yt-dlp, and never logs, returns or stores cookie values anywhere else. The copy disappears with the container; the Secret File stays on Render. When YouTube eventually invalidates the session (the API starts answering `bot_check` again, and the Render logs show *"The provided YouTube account cookies are no longer valid"*), repeat step 1 and paste the new contents into the same Secret File.

With cookies present yt-dlp uses the clients that support them (`web_embedded`, `tv_downgraded`, `mweb`) and skips `visionos` with a one-line warning.

What the Blueprint sets (Dashboard → your service → Environment):

| Variable | Value | Purpose |
|----------|-------|---------|
| `ALLOWED_ORIGINS` | *(you set it)* | Comma-separated frontend origins allowed by CORS |
| `FRONTEND_ORIGIN` | *(you set it)* | Where the API's HTML error pages link "Back to the app" |
| `MAX_CONCURRENT_STREAMS` | `2` | Concurrent ffmpeg streams; the third request gets `503 busy` and retries |
| `JS_RUNTIME` | `deno` | JavaScript runtime for yt-dlp (Deno is in the image) |
| `POT_PROVIDER_URL` | `http://127.0.0.1:4416` | The bundled PO-token server (see [bot_check](#youtube-says-bot_check)); empty disables it |
| `YTDLP_PLAYER_CLIENTS` | `web_embedded,tv_downgraded,mweb,visionos` | yt-dlp player clients to try, in order |
| `YTDLP_FETCH_POT` | `always` | Attach PO tokens to player requests too, not only to media URLs |
| `YTDLP_COOKIES_FILE` | *(you set it: `/etc/secrets/cookies.txt`)* | The logged-in cookies Secret File that clears the bot check (previous section) |
| `LOG_LEVEL` | `INFO` | Set `DEBUG` to get yt-dlp's verbose log in Render's log stream |
| `PYTHONUNBUFFERED` | `1` | Real-time logs |

Health check path is `/api/health`; auto-deploy on push is enabled.

### Updating yt-dlp on Render

YouTube changes frequently; when extraction starts failing with `extraction_failed`, update yt-dlp and push:

```bash
cd backend && uv lock --upgrade-package yt-dlp && git commit -am "chore: bump yt-dlp" && git push
```

Render rebuilds automatically. `/api/health` shows the running `yt_dlp_version`.

## Deploy the frontend to Vercel (free)

1. In [Vercel](https://vercel.com/new) click **Add New → Project** and import the same repository.
2. Configure the project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` · **Output Directory**: `dist` (defaults)
3. **Environment Variables** (Production *and* Preview):
   - `VITE_API_BASE_URL` = `https://<service-name>.onrender.com` (no trailing slash)
   - optional `VITE_LARGE_DOWNLOAD_BYTES` = `524288000` (threshold for the "large download" warning; default 500 MB)
4. Click **Deploy**. `frontend/vercel.json` rewrites every path to `index.html`.
5. Note your URL: `https://<project>.vercel.app` (plus any custom domain you add).

Vercel's Hobby plan is for **non-commercial, personal** use.

## Connect the two and verify

1. Back in Render → your service → **Environment**, set:
   - `ALLOWED_ORIGINS` = `https://<project>.vercel.app` (add more origins comma-separated, e.g. a custom domain; `https://*.vercel.app` preview deployments are already allowed by a built-in regex)
   - `FRONTEND_ORIGIN` = `https://<project>.vercel.app`
   Save → Render redeploys.
2. Verify CORS from the terminal:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$API/api/videos/resolve" \
     -H "Origin: https://<project>.vercel.app" \
     -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
   # 200
   ```

3. Open `https://<project>.vercel.app`. If the API was asleep you will see *"Starting the server… this can take up to a minute"*; once it disappears, paste a link, choose a range, click **Download**.

## Configuration reference

### Backend (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10000` | Port uvicorn binds on `0.0.0.0` (Render sets this) |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins allowed by CORS |
| `ALLOWED_ORIGIN_REGEX` | `^https://.*\.vercel\.app$` | Regex for additional allowed origins (Vercel previews). Set empty to disable |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Link target on HTML error pages |
| `MAX_CONCURRENT_STREAMS` | `2` | Parallel ffmpeg streams before answering `503 busy` (a capacity guard for 512 MB RAM, not a quota) |
| `JS_RUNTIME` | `deno` | yt-dlp JavaScript runtime: `deno`, `node`, `bun`, `quickjs`, or empty to disable |
| `POT_PROVIDER_URL` | `http://127.0.0.1:4416` | bgutil PO-token HTTP server. `start.sh` launches the bundled one when this points at loopback; point it at an external server or set empty to disable |
| `YTDLP_PLAYER_CLIENTS` | `web_embedded,tv_downgraded,mweb,visionos` | Comma-separated yt-dlp `player_client` list (yt-dlp's logged-in defaults first, then the bgutil-attested `mweb` and token-free `visionos`); empty means yt-dlp's defaults |
| `YTDLP_FETCH_POT` | `always` | yt-dlp `fetch_pot`: `never`, `auto`, or `always` |
| `YTDLP_EXTRACTOR_ARGS` | *(unset)* | Extra yt-dlp extractor args in CLI syntax, e.g. `youtube:player_skip=configs;formats=missing_pot` (merged over the two above) |
| `LOG_LEVEL` | `INFO` | App log level; `DEBUG` also enables yt-dlp's verbose output |
| `YTDLP_COOKIES_FILE` | *(unset)* | Netscape-format cookies file of a logged-in (throwaway) YouTube account — the fix for `bot_check` on cloud IPs. Copied once to a private writable file; `/api/health` reports `cookies.available`/`logged_in`; an unreadable or malformed file degrades health instead of being silently ignored |
| `YTDLP_PROXY` | *(unset)* | Proxy URL for yt-dlp and extraction, e.g. `socks5://user:pass@host:1080` |
| `CACHE_TTL_S` | `600` | Seconds to keep a video's metadata in memory so Download right after Load needs no second extraction |
| `CACHE_MAX_ENTRIES` | `50` | Metadata cache size |

### Frontend (Vite build-time variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | *(empty → same origin)* | Backend base URL, no trailing slash |
| `VITE_LARGE_DOWNLOAD_BYTES` | `524288000` | Estimated size above which the bandwidth warning appears |

## Free-tier realities

These are properties of the hosting, not bugs:

- **Cold start (~1 minute).** A Render Free service sleeps after 15 minutes without traffic and takes about a minute to wake. The page shows a banner and disables Download until `/api/health` answers.
- **5 GB/month outbound bandwidth** on Render's Hobby workspace. Every downloaded clip counts. Roughly: 350–500 thirty-second 1080p clips, or a handful of long/4K clips. If you exceed it without a card on file, Render suspends the service until next month; with a card it bills $0.15/GB. The UI shows an estimated size for every clip and warns above 500 MB. The app itself imposes **no** limit.
- **Very large clips** can also trigger Render's "uncommonly high volume of traffic" suspension. Prefer lower resolutions for multi-hour clips.
- **0.1 CPU / 512 MB RAM.** Video is never re-encoded, so MP4/WebM/M4A/Opus are cheap. MP3 and OGG *are* transcoded (audio only) and are slower for long clips. The API process plus the bundled PO-token server idle at roughly 220 MB.
- **Nothing persists** — by design. Downloads run only while your browser is connected; if you close the tab the download stops. Click Download again to re-cut.
- **YouTube challenges cloud IPs** ("Sign in to confirm you're not a bot"). On Render this happens for almost every video; a logged-in cookies file fixes it — see [Clear YouTube's bot check](#clear-youtubes-bot-check-with-a-cookies-file).

## Troubleshooting

### YouTube says `bot_check`
Resolve returns `502 {"code":"bot_check"}`. YouTube is asking the server's IP to prove it is human ("Sign in to confirm you're not a bot") — routine for datacenter ranges such as Render's, where in our tests 7 of 8 videos were challenged.

**The fix is a logged-in cookies file** — follow [Clear YouTube's bot check with a cookies file](#clear-youtubes-bot-check-with-a-cookies-file). yt-dlp's own error text says the same: *"Use --cookies-from-browser or --cookies for the authentication."*

**What the image already does, and why it is not enough on Render.** YouTube normally accepts requests from flagged IPs when they carry a *PO token* (Proof of Origin, produced by Google's BotGuard). The Docker image bundles [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider): `start.sh` launches its Deno server on loopback (`POT_PROVIDER_URL`), the matching yt-dlp plugin fetches tokens from it, and `YTDLP_FETCH_POT=always` attaches them to the player request as well as to media URLs. Tokens live only in the server's memory. On Render the diagnostics show the tokens being issued for every client (`web_embedded`, `tv_downgraded`, `mweb`, and earlier `tv_simply`) and YouTube still answering `LOGIN_REQUIRED` — the IP range is challenged regardless of attestation. The provider stays in the image because it is what makes the media URLs work once a session is present, and because it is sufficient on less-flagged hosts.

**If it still happens with cookies:**

1. Check `/api/health`: `cookies` must be `{"configured":true,"available":true,"logged_in":true}` and `pot_provider.available` must be `true` (otherwise the status is `degraded`; see the two sections below).
2. Read the response's `details.diagnostics` — yt-dlp's per-client trace (PO tokens retrieved, each client's playability status, warnings). Set `LOG_LEVEL=DEBUG` on Render (Environment → save; no rebuild) for yt-dlp's full verbose log.
3. *"The provided YouTube account cookies are no longer valid"* in the logs: the session was rotated (you logged into the account in a browser, or YouTube expired it). Export again and replace the Secret File's contents.
4. **Update yt-dlp and the provider** (see [Updating yt-dlp on Render](#updating-yt-dlp-on-render)); YouTube changes constantly and both projects follow it. Bump `BGUTIL_VERSION`/`DENO_VERSION` in `backend/Dockerfile` together with `bgutil-ytdlp-pot-provider` in `backend/pyproject.toml` — the plugin and server versions must match.
5. **Try other clients** via `YTDLP_PLAYER_CLIENTS` (no rebuild needed), e.g. `tv,web_embedded` — yt-dlp skips clients that cannot carry cookies (`visionos`, `tv_simply`, `android`, `ios`) with a one-line warning when cookies are present. `web` is SABR-only (no direct media URLs).
6. **Proxy**: set `YTDLP_PROXY` to a residential proxy (paid). Cookies and the PO-token server keep working alongside it.
7. **Different host**: the container is portable — anything with a residential IP works, usually without cookies.

To run without the provider (e.g. on a residential IP), set `POT_PROVIDER_URL` empty and `YTDLP_PLAYER_CLIENTS` empty; yt-dlp then uses its default clients.

### `cookies.available: false` or `logged_in: false` in `/api/health`
`configured` is true but the file could not be used; the Render log line starting with `YTDLP_COOKIES_FILE` says why:

- *cannot be read* — the path does not match the Secret File name (it is `/etc/secrets/<filename>`), or the image was rebuilt from a Dockerfile that no longer adds the `app` user to group `1000` (Render grants Secret File access to that group).
- *not a Netscape-format cookies file* — the extension exported JSON, or the paste lost the tab characters. The first line must be `# Netscape HTTP Cookie File` and each cookie is one tab-separated line.
- `logged_in: false` — the file has no `LOGIN_INFO` + `SAPISID`-family cookies for `youtube.com`: the export happened while logged out, or from a different site. Anonymous cookies do not clear the bot check.

Cookie values are never logged. The API keeps working without cookies (status `degraded`) so the misconfiguration is visible without taking the service down.

### `extraction_failed`
yt-dlp could not read the video; the message contains yt-dlp's own text. Usually fixed by updating yt-dlp.

### Download never starts / tab shows an error page
The API answers browser navigations with a small HTML page explaining the error code (`invalid_range`, `unsupported_resolution`, `busy`, …). `busy` pages auto-refresh every 15 s.

### `js_runtime.available: false` in `/api/health`
Locally: install Deno or set `JS_RUNTIME=node`. In Docker this should never happen — check the image built from `backend/Dockerfile`.

### `pot_provider.available: false` in `/api/health`
In Docker the bundled server should be up a second or two after start; check the logs for `[bgutil]` lines (a crash usually means a Deno/bgutil version mismatch — the Dockerfile pins both). Locally the provider is not running unless you start one yourself, so either run the [bgutil server](https://github.com/Brainicism/bgutil-ytdlp-pot-provider#a-po-token-server) or set `POT_PROVIDER_URL=` (empty) to silence the degraded status.

### Clip is a few seconds longer than requested
Expected. Cutting without re-encoding must start at a keyframe (typically ≤ 5 s before your start) and one extra second is read at the end.

### Tests: "ffmpeg/ffprobe are required"
Install ffmpeg. The suite generates its own test media with `ffmpeg -f lavfi`.

## API

Three endpoints, no authentication. Full contract: [specs/001-youtube-clip-download/contracts/openapi.yaml](specs/001-youtube-clip-download/contracts/openapi.yaml).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/videos/resolve` | `{"url": "<youtube link or id>"}` → title, duration, per-container resolutions with bitrates, audio bitrates, start hint |
| `GET` | `/api/clip?v=&start=&end=&format=&height=` | Streams the clip as an attachment. `start`/`end` accept seconds or `HH:MM:SS`; `height` required for `mp4`/`webm`, forbidden for audio formats |
| `GET` | `/api/health` | yt-dlp version, ffmpeg, JS runtime, active streams, RSS |

Errors: `{"code": "...", "message": "..."}` (JSON) or an HTML page when the request comes from a browser tab. Codes: `invalid_url`, `playlist_only`, `invalid_range`, `unsupported_format`, `unsupported_resolution`, `no_audio_track`, `private`, `age_restricted`, `members_only`, `video_unavailable`, `live_in_progress`, `drm_protected`, `geo_blocked`, `bot_check`, `extraction_failed`, `processing_failed`, `busy`.

## Design documents

Built with [Spec Kit](https://github.com/github/spec-kit): [spec](specs/001-youtube-clip-download/spec.md) · [plan](specs/001-youtube-clip-download/plan.md) · [research](specs/001-youtube-clip-download/research.md) · [data model](specs/001-youtube-clip-download/data-model.md) · [contracts](specs/001-youtube-clip-download/contracts/README.md) · [quickstart & validation scenarios](specs/001-youtube-clip-download/quickstart.md) · [tasks](specs/001-youtube-clip-download/tasks.md).
