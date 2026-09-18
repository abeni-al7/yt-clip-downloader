# Research: YouTube Clip Download (Render Free + Vercel Hobby)

**Feature**: `001-youtube-clip-download` | **Date**: 2026-09-18 | **Phase**: 0 | **Revision**: 2.1 (hosting constraints; single user; no storage anywhere)

Revision 2 replaced the self-hosted design (SQLite + stored clips + background worker) with a **stateless streaming** design after the user chose **Render Free** for the backend and **Vercel Hobby** for the frontend. Revision 2.1 applies the user's follow-up decisions: "leave and come back" is dropped, no storage of any kind on the server, a single user, and only the end-to-end cut-and-download flow (no history, no shareable links). Platform facts were verified against render.com/docs/free, render.com/pricing, render.com/docs/outbound-bandwidth, vercel.com/docs/functions/limitations and the yt-dlp README on 2026-09-18.

---

## R0. Hosting constraints that drive the design

| Fact (Render Free web service / Hobby workspace) | Consequence for this feature |
|---|---|
| Ephemeral filesystem: local changes are lost on every redeploy, restart, or idle spin-down; persistent disks are **not** available on Free | Nothing can be stored on the server between requests — no clip files, no SQLite |
| Spins down after 15 min without inbound traffic; spin-up takes ~1 min | First request after idle is slow; the UI must handle a "waking up" state |
| "Render might restart a Free web service at any time" | No server-side job may be assumed to survive; in-progress work must be attached to a live client connection |
| 0.1 CPU / 512 MB RAM | No video re-encoding at all; audio transcoding only; ≤ 2 concurrent ffmpeg processes |
| Hobby workspace: **5 GB/month outbound bandwidth** (then $0.15/GB with a card on file, otherwise services are spun down until next month). Inbound traffic (pulling from YouTube) is not billed | Every byte delivered to a user counts. 5 GB ≈ 350–500 thirty-second 1080p clips, or ≈ 60 thirty-second 4K clips, or ≈ 3 hours of 1080p footage in total |
| Render may suspend a Free service that initiates "an uncommonly high volume of traffic over the public internet" | Multi-hour, multi-GB pulls from YouTube are a suspension risk |
| Free Postgres expires after 30 days; free Key Value is in-memory only | Neither is a usable durable store |
| Docker runtime supported; `PORT` (default 10000) must be bound on `0.0.0.0`; health-check path configurable; 500 build minutes/month | Ship one Docker image with ffmpeg + Deno; bind `$PORT` |
| Outbound egress comes from cloud IP ranges | Higher chance of YouTube's "Sign in to confirm you're not a bot" challenge (R11) |

| Fact (Vercel Hobby) | Consequence |
|---|---|
| Free static hosting with global CDN; SPA fallback via `vercel.json` rewrites; 100 GB/month transfer; non-commercial use only | Ideal for the built SPA. Do **not** proxy API or downloads through Vercel (would double-count bandwidth and hit function limits) — the browser talks to Render directly |

### Why a backend is unavoidable (frontend-only evaluated and rejected)

The user asked whether a frontend-only build would do. It cannot, for reasons outside our control:

1. **Extraction is blocked by CORS.** A web page on `*.vercel.app` cannot call YouTube's player API or fetch the watch page: YouTube sends no `Access-Control-Allow-Origin` for foreign origins. Browser extensions can (they bypass CORS); web pages cannot.
2. **Media bytes are unreadable cross-origin.** `googlevideo.com` stream URLs likewise carry no permissive CORS headers, so `fetch()` can only obtain an opaque response whose bytes JavaScript cannot read — which rules out cutting with ffmpeg.wasm.
3. **Stream URLs are IP-bound.** Each URL embeds the requester's IP; a URL obtained by one party is refused (403) when fetched by another. Whoever extracts must also download.

Any "frontend-only" tool that appears to work is either a browser extension or is secretly calling a proxy. A proxy that must download the bytes anyway might as well cut them — which is exactly the stateless `GET /api/clip` endpoint (R1). That endpoint is the minimum possible backend: no database, no files, no jobs.

**Re-verified 2026-09-18, after the bot check appeared on Render ("is there a source other than the blocked player API?")** — no:

- `POST https://www.youtube.com/youtubei/v1/player` with `Origin: https://<app>.vercel.app` → HTTP 403 for both the preflight and the request; a page cannot do the extraction.
- A live `googlevideo.com` URL fetched with that `Origin` → `206 Partial Content` but **no** `Access-Control-Allow-Origin`; a page cannot read the bytes either.
- Every client yt-dlp knows goes through that same player endpoint; the check is per IP, not per client (`android_vr` additionally needs a DroidGuard PO token nobody can mint server-side; `tv`/`tv_simply` without a session answer `UNPLAYABLE`).
- Community front-ends: the Piped instance directory is offline; the Invidious directory lists 11 instances of which one exposes its API — it returns formats, but its media proxy (`local=true`) sits behind an Anubis proof-of-work challenge (HTML "Making sure you're not a bot!", no bytes for a server), and its direct URLs are bound to *its* IP. Not a foundation.

So the media bytes can only be obtained by the process that called the player API, from an IP (or with a session) YouTube accepts. The remaining levers are therefore about *where* the API is called from: a browser session file on Render (guest or account), a residential host (the operator's machine, Docker + tunnel), another cloud region, or a residential proxy — see README.

### All-on-Vercel alternative (evaluated, not chosen)

The API could run as a Vercel Function instead of a Render web service (single platform, ~1–3 s cold start instead of ~60 s, 100 GB/month transfer instead of 5 GB, 2 GB RAM / 1 vCPU instead of 512 MB / 0.1 CPU). Verified limits that argued against it:

- **Hobby max duration is 300 s, default and maximum, and it includes the time spent streaming the response** — a download that takes longer than 5 minutes is killed with a 504. That is a hard per-download cap the Render design does not have, and it conflicts with the "no limits regarding duration" intent more directly than a monthly bandwidth budget does.
- ffmpeg, yt-dlp and a JS runtime would have to be vendored into a Python function bundle (500 MB limit) rather than installed with `apt`; workable, but fragile and unusual.
- YouTube bot-check exposure is the same (AWS egress IPs).

**Decision**: keep Render Free for the API. Revisit only if the ~60 s cold start proves to be the dominant annoyance; the frontend needs no change to switch, only `VITE_API_BASE_URL`.

## R1. Processing model: stream the cut directly into the download response

**Decision**: `GET /api/clip?v=…&start=…&end=…&format=…&height=…` performs extraction, spawns **ffmpeg** with `-ss/-to` *input* options on the selected YouTube stream URLs and `-c copy`, and pipes ffmpeg's stdout straight into the HTTP response as `Content-Disposition: attachment`. No files are written, no job records exist, nothing survives the request (FR-020). The browser's download manager shows progress and keeps the connection (and therefore the Render instance) alive until the transfer completes; the page tells the user to keep the browser open (FR-021).

**Rationale**:
- Fully compatible with an ephemeral filesystem and random restarts: there is no state to lose. If a restart kills a stream, the user simply clicks Download again.
- Time-to-first-byte is seconds regardless of clip length; cut work stays proportional to the clip (FR-018) because ffmpeg seeks with HTTP `Range` requests on the direct `https` formats.
- Zero infrastructure beyond the web service: no database, no worker, no sweeper, no retention logic. This is the smallest correct system for "simple application, few users".
- Bandwidth is spent exactly once per download and only for bytes the user actually receives; an aborted download stops ffmpeg immediately (R6), wasting nothing.

**Alternatives considered**:
- v1 design (SQLite + stored files + async worker + 24 h retention) — impossible on Render Free without external storage; rejected.
- External durable storage (Cloudflare R2 / Backblaze B2 for files, Neon/Turso for state) — preserves the v1 spec but adds two more accounts and credential sets, an upload step on 0.1 CPU, and still cannot protect in-flight jobs from Render restarts; contradicts "simple"; rejected. Documented as the upgrade path if the spec's 24 h retention is ever reinstated.
- In-memory job queue + `/tmp` files — keeps the status-page UX but is lost on every restart and spin-down, so "leave and come back" would silently fail; rejected as dishonest UX.
- `fetch()` + Blob download in the browser — gives inline error handling but buffers the whole clip in RAM before saving; unusable for long clips; rejected.

## R2. Cutting mechanics (ffmpeg driven directly; yt-dlp for extraction only)

**Decision**: Use yt-dlp as a library for `extract_info(download=False)` only. Build the ffmpeg command ourselves:

```text
ffmpeg -hide_banner -loglevel error -nostdin
  -reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 -reconnect_delay_max 30
  -headers "<http_headers of video format>" -ss START -to END+1 -i <video_url>
  -headers "<http_headers of audio format>" -ss START -to END+1 -i <audio_url>
  -map 0:v:0 -map 1:a:0 -c copy
  <container flags> -f <muxer> pipe:1
```

- `-ss` **before** `-i` with stream copy seeks to the keyframe at/before START (input seeking, no decode) — this is the "nearest natural cut point" behaviour chosen in Q1 (Option B) and now also mandatory: 0.1 CPU cannot re-encode video.
- `END+1` padding guarantees the requested end is inside the clip; SC-012's ≤ 10 s tolerance holds because YouTube keyframe intervals are ≤ ~5 s.
- This is the same mechanism yt-dlp itself uses for `--download-sections` (its `FFmpegFD` with `-ss/-to`), so behaviour against googlevideo URLs is well-trodden.
- Prefer formats with `protocol == "https"` (single-file DASH with `Range` support). Fall back to `m3u8_native` formats if that is all a video exposes; ffmpeg's HLS demuxer honours `-ss` by skipping segments.
- Because the output is a pipe (non-seekable), MP4/M4A use **fragmented MP4**: `-movflags frag_keyframe+empty_moov+default_base_moof`. Fragmented MP4 plays in all modern browsers/players; the file's duration is known once fully downloaded.

**Container/codec plan** (`H` = selected height; sizes drive the UI estimate, R8):

| Output | Streams | Codec handling | Muxer flags | CPU |
|---|---|---|---|---|
| MP4 | best video at exactly `H` (prefer H.264 › VP9 › AV1 at that height) + best AAC audio (`m4a`) | copy | `-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof` | ~0 |
| WebM | best VP9/AV1 video at exactly `H` + best Opus audio | copy | `-f webm` | ~0 |
| M4A | best AAC audio | copy | `-vn -f mp4 -movflags …` (same as MP4) | ~0 |
| Opus | best Opus audio (`webm`/`opus`) | copy | `-vn -f opus` (Ogg Opus) | ~0 |
| MP3 | best audio | `libmp3lame -q:a 2` (VBR ≈ 190 kbps) | `-vn -f mp3` | ≈ 5–10× realtime at 0.1 CPU → a 30 s clip needs ~3–6 s |
| OGG | best audio | `libvorbis -q:a 6` (≈ 190 kbps) | `-vn -f ogg` | same order as MP3 |

**Resolutions offered** (FR-011): `mp4` = every height that has a video stream (any codec is valid inside MP4); `webm` = heights that have a VP9/AV1 stream. Default = highest (FR-011). Above 1080p YouTube serves only VP9/AV1, so a 1440p/2160p MP4 carries VP9/AV1 — plays in Chrome/Edge/Firefox/VLC/Android; the UI shows a one-line compatibility hint.

**Alternatives**: yt-dlp `download_ranges` (writes files; cannot stream a merged cut to stdout reliably) — rejected; `--force-keyframes-at-cuts` / libx264 re-encode for exact boundaries — impossible on 0.1 CPU; rejected.

## R3. YouTube extraction prerequisites

**Decision**: `yt-dlp[default]` (bundles `yt-dlp-ejs`) + **Deno** in the Docker image (`COPY --from=denoland/deno:bin /deno /usr/local/bin/deno`); ffmpeg/ffprobe from Debian packages. Locally, `JS_RUNTIME=node` may be used (Node 22 is installed on the dev machine; Deno is not). `GET /api/health` reports yt-dlp version, ffmpeg presence and detected JS runtime.

**Rationale**: yt-dlp README (verified): "yt-dlp-ejs — Required for full YouTube support"; "A JavaScript runtime/engine like deno (recommended), node.js, bun, or QuickJS is also required"; only `deno` is enabled by default. Without a runtime the `web` client is dropped and format coverage degrades.

**Version policy**: pin in `uv.lock`; upgrade by `uv lock --upgrade-package yt-dlp` + push (Render auto-deploys). No runtime self-update.

## R4. Metadata caching (in-process, per instance)

**Decision**: `POST /api/videos/resolve` stores the full yt-dlp info dict in an in-memory TTL cache (10 min, ≤ 50 entries, keyed by `video_id`). `GET /api/clip` uses the cached entry when present — so a Download right after resolve starts streaming in ~1–3 s — and re-extracts otherwise (e.g. after a restart or spin-down). Stream URLs from YouTube are valid for ~6 h, far longer than the TTL.

**Rationale**: avoids a second YouTube round-trip (and a second bot-check exposure) in the common path, with no correctness dependency: the cache is a pure optimisation and losing it costs a few seconds.

## R5. Concurrency guard

**Decision**: `asyncio.Semaphore(MAX_CONCURRENT_STREAMS)` (default **2**). When no slot is free, `GET /api/clip` returns `503` with `Retry-After: 15`; for browser navigations the HTML error page includes `<meta http-equiv="refresh" content="15">` so the tab retries by itself (R9).

**Rationale**: 512 MB must hold Python + yt-dlp (~120 MB), a transient Deno process during extraction (~60–100 MB) and one ffmpeg per stream (~30–60 MB). Two streams is safe. This is a capacity guard, not a per-user quota (FR-007 is about quotas); with "not many users" it will rarely trigger.

## R6. Client disconnect and process hygiene

**Decision**: ffmpeg runs via `asyncio.create_subprocess_exec`; the response is a `StreamingResponse` over an async generator that reads stdout in 64 KiB chunks. On `CancelledError`/client disconnect or generator close, the process is terminated (`SIGTERM`, then `SIGKILL` after 5 s). stderr is drained concurrently to a bounded buffer and logged on non-zero exit. Deno subprocesses are yt-dlp's responsibility and are short-lived.

**Rationale**: an abandoned stream would otherwise keep pulling from YouTube (suspension risk) and hold a semaphore slot.

## R7. Delivery to the browser (cross-origin download)

**Decision**: The Download control is a plain anchor `<a href="{API}/api/clip?…" target="_blank" rel="noopener">`. The server answers with `Content-Disposition: attachment; filename=…; filename*=UTF-8''…` and `Content-Type` of the container. Modern browsers download and close the helper tab. No `fetch()`, no CORS involvement for downloads, no memory buffering, native progress UI, and the transfer continues even if the SPA tab is closed (as long as the browser stays open). After the click the SPA shows the FR-021 notice: "Your download should start within a few seconds — keep your browser open until it finishes."

**Rationale**: the `download` attribute is ignored cross-origin, so `Content-Disposition` is the mechanism; a new tab keeps the SPA intact if the server returns an HTML error page instead of a file (R9).

**Alternatives**: hidden `<iframe>` (errors become invisible) and `window.location.href` (an error page would replace the SPA) — rejected.

## R8. Size estimate and bandwidth budget

**Decision**: `VideoInfo` carries bitrates: `resolutions.mp4[] = {height, fps, vcodec, video_kbps}`, `resolutions.webm[]` likewise, and `audio = {m4a_kbps, opus_kbps}`. The UI computes `estimate = duration × (video_kbps + audio_kbps) / 8` (MP3/OGG use fixed 190 kbps). The estimate is always shown next to the Download control (FR-009); at ≥ 500 MB (`VITE_LARGE_DOWNLOAD_BYTES`) an amber note explains that the free server has a small monthly bandwidth budget. Nothing is blocked — FR-006/FR-007 stand.

**Rationale**: the 5 GB/month cap is the binding constraint of this deployment. Users choosing a lower resolution or a shorter range is the only lever that keeps the tool free; the estimate makes that choice informed (spec edge case "extremely large output").

## R9. Error responses for navigations

**Decision**: `api/errors.py` negotiates on `Accept`: JSON `{code, message}` for API clients (resolve/health, tests), a minimal self-contained HTML page (inline CSS, message, "Back to the app" link to `FRONTEND_ORIGIN`, auto-refresh only for `503 busy`) when the request is a browser navigation to `/api/clip`. The same `ErrorCode` table (R11) is used for both.

## R10. Cold start handling

**Decision**: On load the SPA calls `GET /api/health` with a 90 s timeout and shows a discreet "Starting the server (free hosting sleeps when idle) — this can take up to a minute" banner until it answers; the URL input remains usable. `resolve` uses a 120 s timeout and retries once on network error/502/503. Render's own "loading" page only appears for navigations, so the SPA's banner is what users see.

**Alternative rejected**: external uptime pingers to keep the instance awake — works against the platform's intent and burns the 750 h/month allowance; not recommended.

## R11. Error classification (FR-019, FR-022) and the bot-check risk

| Signal (yt-dlp) | Code | HTTP | User message |
|---|---|---|---|
| `Private video` | `private` | 422 | This video is private. |
| `Sign in to confirm your age` | `age_restricted` | 422 | This video is age-restricted and requires sign-in on YouTube. |
| `Join this channel` / members-only | `members_only` | 422 | This video is for channel members only. |
| `Video unavailable` / removed / does not exist | `video_unavailable` | 422 | This video is unavailable or has been removed. |
| `live_status ∈ {is_live, is_upcoming, post_live}` | `live_in_progress` | 422 | Only completed videos can be clipped. |
| DRM | `drm_protected` | 422 | This video is DRM-protected. |
| `not available in your country` | `geo_blocked` | 422 | This video is not available in the server's region. |
| `Sign in to confirm you're not a bot` | `bot_check` | 502 | YouTube is asking the server to prove it isn't a bot. Please try again later. |
| Other extraction error | `extraction_failed` | 502 | yt-dlp message, trimmed |
| Audio output requested, no `acodec != none` format | `no_audio_track` | 400 | This video has no audio track to extract. |
| Semaphore full | `busy` | 503 | The server is busy with other clips — retrying automatically. |
| ffmpeg exits non-zero before first byte | `processing_failed` | 502 | Cutting the clip failed. Please try again. |

**Bot-check risk is HIGH on Render** because egress comes from cloud IP ranges that YouTube challenges more aggressively than residential ones. Mitigations, in order: (1) keep yt-dlp current (its EJS/PO-token support resolves many challenges); (2) operator-supplied cookies via a Render **secret file** exposed as `YTDLP_COOKIES_FILE` — a documented yt-dlp option, used at the operator's own risk (YouTube may act on the account); (3) optional `YTDLP_PROXY` for a residential proxy (paid, outside this plan); (4) the image is host-agnostic, so the same container runs on any machine with a residential IP. The quickstart front-loads a Render smoke test (S0) so this risk is discovered before UI work.

**Outcome after the first deployment (S0 failed)**: 7 of 8 probe videos returned `bot_check` from Render with yt-dlp's default `visionos,web` clients. The fix that keeps the "no storage, no account" constraints is a **PO-token provider**: the image bundles the [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) Deno server (started by `start.sh` on loopback, tokens held only in memory) and the matching yt-dlp plugin; yt-dlp is configured with `player_client=mweb,visionos` (bgutil attests WebPO clients such as `mweb`, not `visionos`/`android`/`ios`) and `fetch_pot=always`, so the *player* request also carries a PO token — that is what clears "Sign in to confirm you're not a bot", while the GVS token is appended to media URLs (`pot=`). Everything is tunable at runtime via `YTDLP_PLAYER_CLIENTS`, `YTDLP_FETCH_POT`, `YTDLP_EXTRACTOR_ARGS`, `POT_PROVIDER_URL`, `LOG_LEVEL`; `/api/health` reports `pot_provider` and `player_clients`, and `bot_check`/`extraction_failed` responses include `details.diagnostics` (yt-dlp's per-client warnings). Cost: ~150 MB RSS for the Deno server (≈220 MB total, within 512 MB), +1–2 s per uncached resolve after the first token. Cookies/proxy remain as fallbacks.

**Outcome after the second deployment (PO tokens alone were not enough on Render)**: with the provider running (`pot_provider.available: true`) the diagnostics showed player PO tokens issued for `tv_simply`, `tv_downgraded`, `web_embedded` and `mweb`, yet YouTube answered `LOGIN_REQUIRED` ("Sign in to confirm you're not a bot") for every client (`tv_simply`: `UNPLAYABLE`) on 7 of 8 probe videos — the IP range is challenged regardless of attestation. The remaining lever yt-dlp offers is a **logged-in session**: `YTDLP_COOKIES_FILE` pointing at a Render Secret File exported from a throwaway account. Implementation details that make this work unattended: (1) `prepare_cookies()` copies the read-only secret to a private `0600` file because yt-dlp rewrites its cookie file after every run (session rotation) and silently runs *without* cookies when the file is unreadable; (2) the Dockerfile adds the non-root user to group `1000`, which Render uses to grant Secret File access; (3) `/api/health` reports `cookies {configured, available, logged_in}` and degrades when a configured file is unusable; (4) yt-dlp runs are serialised while cookies are in use so concurrent rewrites cannot corrupt the jar; (5) the default `YTDLP_PLAYER_CLIENTS` became `web_embedded,tv_downgraded,mweb,visionos` — yt-dlp's own logged-in defaults first (it skips cookie-less clients such as `visionos` when cookies are present). Cookie values are never logged or returned. The provider stays: it is what attests the media URLs once a session exists, and suffices on less-flagged hosts.

## R12. Link canonicalisation (unchanged from v1)

Accept hosts `youtube.com`, `www.`, `m.`, `music.`, `youtube-nocookie.com`, `youtu.be`; shapes `/watch?v=ID`, `youtu.be/ID`, `/shorts/ID`, `/live/ID`, `/embed/ID`, `/v/ID`; `ID = [A-Za-z0-9_-]{11}`; start hint from `t`/`start` (`90`, `90s`, `1m30s`, `1h2m3s`, `#t=`); `list=` ignored when a video ID is present; `/playlist?list=` alone → `playlist_only`. Implemented server-side (authoritative) and mirrored client-side. Only the canonical `https://www.youtube.com/watch?v=ID` is ever handed to yt-dlp, and only yt-dlp-supplied googlevideo URLs are ever handed to ffmpeg — user input never reaches a network client directly (SSRF-safe).

## R13. No history, no shareable links (user decision)

**Decision**: The SPA keeps no state beyond the current form — no `localStorage`, no recent-clips list, no recipe links. "Make another clip" simply keeps the resolved video loaded (FR-023).

**Rationale**: The user asked for a single-user tool with only the end-to-end flow. Revision 2 had proposed browser-side "recipes" as a substitute for the dropped server-side history; with US5 and FR-022 removed from the spec there is nothing left to substitute for, and each removed feature is one fewer component to build and test. A future user could re-add recipes purely in the frontend without touching the API.

## R14. File naming (unchanged)

`"{title} [{HH-MM-SS}-{HH-MM-SS}].{ext}"`, sanitised with `yt_dlp.utils.sanitize_filename`, trimmed to 120 chars, sent as `filename=` (ASCII fallback) + `filename*=UTF-8''…`.

## R15. Frontend stack (unchanged, deployment added)

Vite + React 19 + TypeScript, hand-written CSS, Vitest + Testing Library; a single page with no router. Deployed on **Vercel Hobby** with root directory `frontend/`, framework preset *Vite*, `VITE_API_BASE_URL=https://<service>.onrender.com`, and `vercel.json` rewriting all paths to `/index.html` (static assets are served first). No server functions.

## R16. Backend stack and deployment

Python ≥ 3.12, uv, FastAPI + uvicorn, pydantic v2, `yt-dlp[default]`, `CORSMiddleware` with `ALLOWED_ORIGINS` (production Vercel domain, `https://*.vercel.app` previews via regex, `http://localhost:5173`). Deployed on **Render Free** from a `render.yaml` blueprint: `runtime: docker`, `dockerfilePath: backend/Dockerfile`, `plan: free`, `healthCheckPath: /api/health`, env `ALLOWED_ORIGINS`, `FRONTEND_ORIGIN`, `MAX_CONCURRENT_STREAMS=2`, `PYTHONUNBUFFERED=1`; uvicorn binds `0.0.0.0:$PORT`. Native (non-Docker) Python runtime is not an option because ffmpeg and Deno cannot be installed there.

## R17. Testing strategy

- **Unit** (pytest): URL canonicalisation, timestamp grammar, format planning (ffmpeg argv builder is a pure function), size estimate, filename, error classification.
- **Integration** (pytest + httpx): API with `FakeExtractor` returning a synthetic info dict whose "stream URLs" are local files generated once per session with `ffmpeg -f lavfi -i testsrc … -f lavfi -i sine …` — the real ffmpeg streaming path is exercised end-to-end offline; assertions use ffprobe on the streamed bytes (duration ≥ requested, ≤ requested + 10 s; codec per format).
- **Live** (opt-in `YTCLIP_LIVE=1`): one real resolve + one 20 s MP4 + one 20 s MP3 against a known public video.
- **Frontend** (Vitest): timestamp/URL parsing, estimate maths, RangeSelector interactions, server-waking banner.

---

## Resolved unknowns summary

| Technical Context item | Resolution |
|---|---|
| Language/Version | Python ≥ 3.12 (backend image `python:3.12-slim`), TypeScript 5 / Node 22 (frontend build) — R15, R16 |
| Primary dependencies | FastAPI, uvicorn, pydantic v2, yt-dlp[default], ffmpeg, Deno; React 19, Vite — R2, R3, R15, R16 |
| Storage | **None anywhere** (FR-020); 10-min in-memory metadata cache is an optimisation only — R1, R4, R13 |
| Testing | pytest/httpx with fake extractor + real ffmpeg on synthetic media; Vitest — R17 |
| Target platform | Render Free (Docker, Linux) + Vercel Hobby (static); evergreen browsers — R0, R15, R16 |
| Project type | Web application: `backend/` API + `frontend/` SPA, deployed separately — R15, R16 |
| Performance goals | First bytes ≤ 5 s warm (SC-010); cold start ≤ ~60 s; ≤ 2 concurrent streams — R1, R5, R10 |
| Constraints | No auth/quotas/duration limits in the app; 5 GB/month bandwidth budget; stream copy only; no server state — R0, R1, R8 |
| Scale/Scope | One user; 1 page; 3 API endpoints; ~12 UI components — R13, R15 |
