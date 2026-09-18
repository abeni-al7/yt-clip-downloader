# Quickstart: YouTube Clip Download

**Feature**: `001-youtube-clip-download` | **Date**: 2026-09-18 | **Phase**: 1 | **Revision**: 2.1 (Render Free + Vercel Hobby, single user, no storage)

How to run the two parts locally, deploy them to the free tiers, and prove each user story end-to-end. Implementation lives in `tasks.md` and the code; contracts are in [contracts/](contracts/README.md), the models in [data-model.md](data-model.md).

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Python | ≥ 3.12 | backend |
| uv | ≥ 0.4 | Python env + lockfile |
| Node.js | ≥ 20 | frontend build; also usable as yt-dlp JS runtime in dev (`JS_RUNTIME=node`) |
| ffmpeg + ffprobe | ≥ 6 | cutting, muxing, audio transcode, validation |
| Docker | current | build the Render image locally (optional) |
| Accounts | Render (Hobby workspace), Vercel (Hobby), GitHub | deployment |

Check: `python3 --version && uv --version && node --version && ffmpeg -version | head -1 && ffprobe -version | head -1`

## Run locally (two terminals)

```bash
# 1. backend
cd backend
uv sync
export ALLOWED_ORIGINS=http://localhost:5173 FRONTEND_ORIGIN=http://localhost:5173 JS_RUNTIME=node
uv run uvicorn ytclip.main:app --reload --port 8000

# 2. frontend
cd frontend
npm install
echo 'VITE_API_BASE_URL=http://localhost:8000' > .env.local
npm run dev                                   # http://localhost:5173
```

Same image as production: `docker build -t ytclip backend && docker run --rm -p 8000:10000 -e ALLOWED_ORIGINS=http://localhost:5173 ytclip` (the image defaults `PORT=10000` like Render).

## Automated checks

```bash
cd backend && uv run ruff check . && uv run pytest              # unit + integration; real ffmpeg on synthetic media, offline
cd backend && YTCLIP_LIVE=1 uv run pytest tests/live -m live    # opt-in: real YouTube, needs network
cd frontend && npm run lint && npm test                          # vitest
```

Expected: all green. Integration tests stream clips from generated media through the real `GET /api/clip` path and assert with ffprobe (duration within `[requested, requested + 10 s]`, codecs per format).

## Deploy

### Backend → Render Free (Docker)

1. Push the repo to GitHub. `render.yaml` at the repo root declares one web service: `runtime: docker`, `dockerfilePath: backend/Dockerfile`, `dockerContext: backend`, `plan: free`, `healthCheckPath: /api/health`, env vars `ALLOWED_ORIGINS`, `FRONTEND_ORIGIN`, `MAX_CONCURRENT_STREAMS=2`, `PYTHONUNBUFFERED=1`.
2. Render Dashboard → *New → Blueprint* → select the repo → apply. First build ≈ 5–8 min (ffmpeg apt + uv sync); later builds reuse layers.
3. Note the URL `https://<service>.onrender.com`. Set `ALLOWED_ORIGINS` to the Vercel production URL once known (comma-separated; `https://*.vercel.app` previews are matched by regex).
4. Secrets (needed on Render — S0 fails with `bot_check` there even with PO tokens, research R11 outcome): Render → *Environment → Secret Files* → upload `cookies.txt` exported from a browser — first a logged-out guest session (no account needed), and only if that is refused a spare account via yt-dlp's incognito procedure (at your own risk) — set `YTDLP_COOKIES_FILE=/etc/secrets/cookies.txt`, and confirm `/api/health` shows `cookies.available: true`. If neither session is accepted, run the API on a home connection (README → *Run the API at home instead*). Full steps: README → *Clear YouTube's bot check with a cookies file*.

### Frontend → Vercel Hobby (static)

1. Vercel → *Add New Project* → import the repo → **Root Directory** `frontend`, Framework preset *Vite*, Build `npm run build`, Output `dist`.
2. Environment variable `VITE_API_BASE_URL=https://<service>.onrender.com` (Production + Preview).
3. `frontend/vercel.json` contains the SPA rewrite `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`.
4. Deploy; note `https://<project>.vercel.app`; put it into Render's `ALLOWED_ORIGINS` and `FRONTEND_ORIGIN`, redeploy backend.

### Post-deploy checks

```bash
API=https://<service>.onrender.com
time curl -s $API/api/health | jq          # first call after idle: ~60 s (spin-up); then < 1 s
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://<project>.vercel.app' -X OPTIONS \
  -H 'Access-Control-Request-Method: POST' $API/api/videos/resolve      # 200 with CORS headers
```

## Validation scenarios

`VIDEO` = a public, non-age-restricted video ≥ 3 min with ≥ 1080p. Commands hit the API directly; each has a UI equivalent in [ui-contract.md](contracts/ui-contract.md). Run **S0 first, on Render** — it is the go/no-go for this hosting choice.

### S0 — Hosting smoke test (bot-check go/no-go, R11)

```bash
curl -s $API/api/videos/resolve -H 'content-type: application/json' -d "{\"url\":\"$VIDEO\"}" | jq '{title, duration_s, mp4: .resolutions.mp4[0]}'
curl -s -o /tmp/s0.mp4 -D - "$API/api/clip?v=<id>&start=60&end=80&format=mp4&height=720"
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/s0.mp4     # 20–30
```

Expected: 200s and a playable file. If resolve returns `502 bot_check`, confirm `/api/health` shows `pot_provider.available: true` and `cookies.available: true` (research R11 outcome: on Render the PO-token provider alone does not clear the check; a browser-session cookies Secret File — guest or account — is needed, or a residential host), read `details.diagnostics` in the error body (per-client playability, token retrieval), and only then consider other `YTDLP_PLAYER_CLIENTS` values, a residential proxy, or a different host/region — the rest of the plan is unaffected but this deployment is.

### S1 — Cut and download a clip (US1, P1)

```bash
curl -s -OJ -D /tmp/h.txt "$API/api/clip?v=<id>&start=00:01:00&end=00:01:30&format=mp4&height=1080"
grep -i 'content-disposition\|content-type' /tmp/h.txt      # attachment; filename*=…[00-01-00-00-01-30].mp4 ; video/mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 "<file>"                       # 30 ≤ d ≤ 40  (FR-014, SC-012)
ffprobe -v error -select_streams v:0 -show_entries stream=height,codec_name -of csv=p=0 "<file>"   # 1080,h264|vp9|av1  (FR-012)
```

Expected: first bytes within ~5 s on a warm server (SC-010); no auth/quota anywhere; file plays in a browser/VLC (fMP4).

Negative checks (all return a specific `code`/`message`, JSON with `Accept: application/json`, HTML otherwise — FR-019, SC-008):
- `end ≤ start` → `400 invalid_range`; `end` beyond duration → UI clamps, raw API `400 invalid_range`.
- `v=https://example.com/x` → `400 invalid_url`; `v=https://www.youtube.com/playlist?list=PL…` → `400 playlist_only`.
- private / removed / age-restricted video → `422` + specific code (FR-022).
- Run the same download 5× → five 200s (FR-007, SC-007).
- Third concurrent download while two are streaming → `503 busy` with `Retry-After` (capacity guard; not a quota).

### S2 — Output formats (US2, P2)

Repeat S1 with `format=mp3` (no `height`), then `webm&height=<from resolutions.webm>`, `m4a`, `ogg`, `opus`.

Expected per file (`ffprobe -v error -show_entries stream=codec_type,codec_name -of csv=p=0`): `mp3 → audio,mp3`; `m4a → audio,aac`; `ogg → audio,vorbis`; `opus → audio,opus`; `webm → video,vp9|av1 + audio,opus`; `mp4 → video,* + audio,aac`. Extensions match (US2 scenario 4); durations 30–40 s. Audio format with `height` → `400 unsupported_resolution`; video format without `height` → `400 unsupported_resolution`; a no-audio video → `400 no_audio_track` (integration test with the fake extractor).

### S3 — Cut time independent of source length (FR-018, SC-003)

Time `curl -o /dev/null` for a 30 s 720p MP4 from a ~5-min video and from a ≥ 3-hour video. Expected: long-source time ≤ 1.25 × short-source time (both dominated by the download itself).

### S4 — No duration limit (FR-006) — run locally, not on Render

`start=0&end=<full duration>` on a ≥ 1-hour video against the **local** backend. Expected: streams to completion, no timeout, `ffprobe` duration ≈ video length (SC-006). On Render this same call would consume the month's 5 GB budget (spec Assumptions → Hosting budget); the UI shows `large_download_note` for it.

### S5 — Visual range selection (US3, P3) — UI only

Drag start handle → field + preview update; type `2:00` in end → handle moves; *Preview selection* plays start→end and pauses; on a 10-hour video use zoom + nudge to reach `05:00:01`; repeat a drag with DevTools touch emulation.

### S6 — Quality selection (US4, P4)

`height=720` on a video with 1080p + 720p → `ffprobe … stream=height` prints `720`; quality picker hidden for audio formats.

### S7 — Nothing is stored on the server (FR-020)

Run against the local Docker image so the filesystem can be inspected:

```bash
CID=$(docker run -d -p 8000:10000 -e ALLOWED_ORIGINS=http://localhost:5173 ytclip)
curl -s -o /dev/null "http://localhost:8000/api/clip?v=<id>&start=60&end=90&format=mp4&height=720"
docker diff "$CID" | grep -v '^C /tmp$' ; echo "exit=$?"          # expect no A/C lines under /app, /tmp or /root (exit=1 = no output)
docker exec "$CID" sh -c 'ls -A /tmp; find / -xdev -newer /proc/1 -type f 2>/dev/null | grep -v "^/proc\|^/sys\|^/dev"'
docker stop "$CID" >/dev/null
```

Expected: no new or changed files after a completed download (yt-dlp cache disabled, ffmpeg writes only to the pipe); the UI shows `download_hint` after the click (FR-021).

### S8 — Cold start and disconnect hygiene (R6, R10)

1. Leave the Render service idle > 15 min; open the SPA → `server_waking` banner appears, disappears when `/api/health` answers (≤ ~90 s); Download enabled only then.
2. Start a long download locally, cancel it in the browser after 5 s; `ps aux | grep ffmpeg` shows no ffmpeg within 6 s; `/api/health` → `streams.active: 0`.

## Success-criteria checklist

| SC | Verified by |
|----|-------------|
| SC-001 | Manual timing of S1 in the UI (< 2 min on a warm server) |
| SC-002 | S1 (30 s clip fully downloaded ≤ 30 s) |
| SC-003 | S3 |
| SC-004 | S1/S6 ffprobe height; 4K source at default → 2160 |
| SC-005 | Stream copy — no overlay code path exists |
| SC-006 | S4 locally; on Render limited by the bandwidth budget (spec Assumptions) |
| SC-007 | S1 negatives (5× download); no auth/quota code |
| SC-008 | S1 negatives + S0: every failure has a specific `code`/`message` |
| SC-009 | S2 files open in VLC/browser/phone (fMP4 for MP4/M4A) |
| SC-010 | S1 first-byte timing (≤ 5 s warm) |
| SC-011 | Usability session (out of band) |
| SC-012 | S1/S2 duration bounds (30–40 s for a 30 s request) |
