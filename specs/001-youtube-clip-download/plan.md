# Implementation Plan: YouTube Clip Download

**Branch**: `001-youtube-clip-download` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md) | **Revision**: 2.1 — Render Free + Vercel Hobby, stateless, single user

**Input**: Feature specification from `/specs/001-youtube-clip-download/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A small two-part web app for a single user: a **static React SPA on Vercel Hobby** and a **stateless FastAPI service in a Docker container on Render Free**. The user pastes a YouTube link, the API resolves title/duration/available resolutions, the user picks a range (typed or via a dual-handle slider with preview), a format (MP4, WebM, MP3, M4A, OGG, Opus) and a resolution, and clicks Download — which opens `GET /api/clip?…` in a new tab. The server runs **ffmpeg with input-side seeking and stream copy** on the YouTube stream URLs that **yt-dlp** extracted and pipes the output straight into the download response, so only the requested byte ranges are ever fetched from YouTube and **nothing is stored on the server** (FR-020). There is no job, status, history or link feature: the download *is* the processing, and the browser stays open until it finishes (FR-021). No accounts, quotas or duration limits exist in the application; the deployment's practical ceiling is Render Hobby's **5 GB/month outbound bandwidth**, which the UI makes visible through a per-clip size estimate (FR-009).

A frontend-only implementation was evaluated and ruled out (research R0): a web page cannot read YouTube's player API or media bytes cross-origin, and the media URLs are bound to the requesting IP, so a server-side proxy that cuts on the fly is the minimum possible backend.

## Technical Context

**Language/Version**: Python ≥ 3.12 (backend; `python:3.12-slim` image, developed on 3.14); TypeScript 5 on Node 22 (frontend build only)

**Primary Dependencies**: FastAPI, uvicorn, pydantic v2, `yt-dlp[default]` (metadata extraction only), ffmpeg/ffprobe (Debian package), Deno (yt-dlp JS runtime); React 19, Vite (single page, no router)

**Storage**: None — on the server or in the browser. The only transient state is a 10-minute in-memory metadata cache on the server (an optimisation, not a store). No database, no object storage, no persistent disk, no localStorage.

**Testing**: pytest + pytest-asyncio + httpx with a fake extractor and **real ffmpeg on synthetic media**, assertions via ffprobe; opt-in live tests against YouTube; Vitest + Testing Library for the SPA

**Target Platform**: Backend — Render Free web service (Docker, Linux, 0.1 CPU / 512 MB, ephemeral FS, idle spin-down, ~1 min cold start). Frontend — Vercel Hobby static site (global CDN). Browsers — evergreen desktop and mobile

**Project Type**: Web application — `backend/` (API) and `frontend/` (SPA), deployed independently, CORS-connected

**Performance Goals**: First bytes of a warm download within 5 s of clicking Download (SC-010); a 30 s 1080p clip fully downloaded within 30 s on a normal connection (SC-002); cut time independent of source length (SC-003); cold start ≤ ~60 s surfaced honestly in the UI; 2 concurrent streams

**Constraints**: No authentication, quotas, rate limits or maximum duration in the app (FR-006–FR-008); no video re-encoding (0.1 CPU and FR-014); nothing stored anywhere on the server (FR-020); 5 GB/month outbound bandwidth on Render Hobby; 512 MB RAM; Vercel Hobby is non-commercial use only; YouTube may bot-challenge cloud IPs (risk, R11)

**Scale/Scope**: One user; 1 page; 3 API endpoints (`resolve`, `clip`, `health`); ~12 UI components; 2 deployment manifests (`render.yaml`, `vercel.json`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so there are no ratified gates. Spec Kit defaults applied as self-imposed gates:

| Gate | Status | Note |
|------|--------|------|
| Simplicity — no more projects than needed | PASS | Two projects (`backend/`, `frontend/`) forced by the two hosting targets. No database, worker, queue, storage service, or client-side persistence. |
| No speculative abstraction | PASS | `Extractor` is the only protocol (needed for offline tests); ffmpeg argv building is a pure function; no repository/ORM/job layers. |
| Every requirement traceable | PASS | FR-001–FR-024 all mapped to modules in [contracts/README.md](contracts/README.md). |
| Testability first | PASS | Streaming path is exercised offline with real ffmpeg on generated media; YouTube access is isolated behind `Extractor`. |
| Spec constraints honoured | PASS | No auth/quotas/limits; stream copy only; no server storage (FR-020); keep-browser-open notice (FR-021). Spec was amended on 2026-09-18 to drop US5/retention/history — see spec.md → Clarifications. |

**Post-Phase-1 re-check**: PASS — design adds nothing beyond the three endpoints and one page; no Complexity Tracking entries.

## Spec Alignment (revision 2.1)

The user accepted the hosting trade-offs and amended the spec accordingly (spec.md → Clarifications, Session 2026-09-18):

- **Dropped**: US5 "Leave and come back", 24 h retention, server-side clip links, recent-clips list, background processing after the browser closes, Retry-as-a-server-action.
- **Added**: FR-020 (no server storage of any kind), FR-021 (keep-browser-open notice), FR-009 now includes the size estimate, SC-010 (download starts ≤ 5 s warm).
- **Kept unchanged**: no duration limit (FR-006), no quotas/auth (FR-007/008), stream copy with outward-snapping boundaries (FR-014), all six formats, resolution choice, visual range selection.

All 24 functional requirements are implemented as specified; nothing in this plan substitutes for a spec item any more.

## Project Structure

### Documentation (this feature)

```text
specs/001-youtube-clip-download/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command) — R0–R17, revision 2.1
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── README.md        #   endpoint index + FR coverage
│   ├── openapi.yaml     #   HTTP API contract (3 endpoints)
│   └── ui-contract.md   #   page states, components, validation, cold-start UX, copy deck
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── Dockerfile                      # python:3.12-slim + ffmpeg (apt) + deno (COPY --from=denoland/deno:bin) + uv sync --frozen
├── pyproject.toml                  # fastapi, uvicorn, pydantic, yt-dlp[default]; dev: pytest, pytest-asyncio, httpx, ruff
├── uv.lock
├── src/ytclip/
│   ├── __init__.py
│   ├── main.py                     # app factory, CORSMiddleware, routers, binds 0.0.0.0:$PORT
│   ├── config.py                   # ALLOWED_ORIGINS, FRONTEND_ORIGIN, MAX_CONCURRENT_STREAMS, JS_RUNTIME,
│   │                               # YTDLP_COOKIES_FILE, YTDLP_PROXY, CACHE_TTL_S, PORT
│   ├── api/
│   │   ├── videos.py               # POST /api/videos/resolve
│   │   ├── clip.py                 # GET  /api/clip  (streaming download)
│   │   ├── health.py               # GET  /api/health
│   │   └── errors.py               # ErrorCode → status/message; JSON or HTML by Accept (R9)
│   ├── domain/
│   │   ├── youtube_url.py          # canonicalise → video_id + start hint (R12)
│   │   ├── timestamps.py           # HH:MM:SS / MM:SS / SS / 1h2m3s
│   │   ├── models.py               # VideoInfo, ClipParams, OutputFormat, ErrorCode (pydantic)
│   │   ├── format_plan.py          # info dict + params → chosen formats + ffmpeg argv (pure, R2)
│   │   ├── estimate.py             # size estimate inputs (bitrates per height / audio) (R8)
│   │   └── filenames.py            # download name + Content-Disposition (R14)
│   ├── media/
│   │   ├── extractor.py            # Extractor protocol + YtDlpExtractor (+ error classification, R11)
│   │   ├── cache.py                # TTL cache of info dicts (R4)
│   │   ├── streamer.py             # ffmpeg subprocess → async chunk generator; kill on disconnect (R6)
│   │   └── fakes.py                # FakeExtractor serving synthetic local media
│   └── limits.py                   # asyncio.Semaphore guard (R5)
└── tests/
    ├── conftest.py                 # generates synthetic test media with ffmpeg lavfi once per session
    ├── unit/                       # youtube_url, timestamps, format_plan, estimate, filenames, errors
    ├── integration/                # resolve + clip streaming with FakeExtractor; ffprobe assertions
    └── live/                       # opt-in (YTCLIP_LIVE=1)

frontend/
├── package.json
├── vite.config.ts                  # dev proxy /api → http://localhost:8000
├── vercel.json                     # SPA rewrite to /index.html
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx                     # single page; owns url → video → range/format/quality state
│   ├── api/client.ts               # resolve(), health(), clipUrl(params) — base URL from VITE_API_BASE_URL
│   ├── lib/
│   │   ├── youtubeUrl.ts           # client mirror of R12
│   │   ├── timestamps.ts
│   │   ├── estimate.ts             # bytes ≈ duration × kbps / 8 (R8)
│   │   └── format.ts               # human sizes/durations
│   ├── hooks/
│   │   ├── useServerStatus.ts      # health ping + "waking up" banner (R10)
│   │   └── useYouTubePlayer.ts     # IFrame API preview
│   ├── components/
│   │   ├── ServerStatusBanner.tsx
│   │   ├── UrlInput.tsx
│   │   ├── VideoCard.tsx
│   │   ├── RangeSelector.tsx       # dual-handle + zoom + nudge
│   │   ├── TimestampField.tsx
│   │   ├── PreviewPlayer.tsx
│   │   ├── FormatPicker.tsx
│   │   ├── QualityPicker.tsx
│   │   ├── BoundaryNotice.tsx      # FR-015
│   │   ├── SizeEstimate.tsx        # estimate + large-download note (FR-009, R8)
│   │   ├── DownloadButton.tsx      # <a href={clipUrl} target="_blank">; label shows duration (FR-009)
│   │   ├── DownloadHint.tsx        # "keep your browser open…" after click (FR-021)
│   │   └── ErrorMessage.tsx
│   └── pages/HomePage.tsx
└── tests/

render.yaml                         # blueprint: one free Docker web service, healthCheckPath /api/health
README.md                           # deploy steps for Render + Vercel, env vars, bandwidth note
```

**Structure Decision**: Two independently deployed projects because the hosting targets differ (Render runs containers; Vercel serves static files). The backend has no persistence layer at all: `domain/` is pure logic (exhaustively unit-tested), `media/` wraps yt-dlp and ffmpeg behind small seams, `api/` is a thin HTTP layer. The frontend is a single page with no router and no persisted state — exactly the end-to-end flow and nothing else.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — table intentionally left empty.

## Design Artifacts

- [research.md](research.md) — R0 hosting constraints & frontend-only evaluation + R1–R17 decisions (streaming model, ffmpeg plan, cache, concurrency guard, cold start, bot-check risk)
- [data-model.md](data-model.md) — `VideoInfo` read model, `ClipParams` request, validation rules, error codes; nothing persisted anywhere
- [contracts/openapi.yaml](contracts/openapi.yaml) — `POST /api/videos/resolve`, `GET /api/clip`, `GET /api/health`
- [contracts/ui-contract.md](contracts/ui-contract.md) — page states incl. server-waking and post-click, copy deck
- [quickstart.md](quickstart.md) — local run, Render + Vercel deployment, S0 bot-check smoke test first, validation scenarios S1–S7

## Risks & Mitigations

| Risk | Likelihood / impact | Mitigation |
|------|---------------------|------------|
| YouTube bot-check on Render's cloud IPs blocks extraction | **High** / feature unusable on this host | S0 smoke test before UI work; keep yt-dlp current; `YTDLP_COOKIES_FILE` secret file (operator's risk); `YTDLP_PROXY`; container is portable to any host with a residential IP |
| 5 GB/month outbound exhausted → service spun down for the month (no card) or billed $0.15/GB (card) | Medium / outage or small cost | Size estimate + warning in UI; operator decides on adding a card; README documents the budget |
| One multi-GB clip triggers Render's "uncommonly high traffic" suspension | Low–medium / suspension | Same estimate/warning; documented; restore requires upgrading the service |
| Cold start (~60 s) confuses the user | High / annoyance — a single occasional user will hit it on most visits | Health ping + banner on load; long client timeouts; Download disabled until the server answers. If this becomes the main pain point, the all-on-Vercel variant in research R0 trades it for a 300 s per-download cap |
| Instance restart or spin-down mid-download | Low / interrupted file | Browser shows a failed download; user clicks Download again (idempotent request) |
| Memory pressure with 2 streams + Deno extraction | Low / OOM restart | `MAX_CONCURRENT_STREAMS=2`; extraction serialised behind the same guard; health exposes RSS |
| MP3/OGG transcoding slow on 0.1 CPU for long clips | Medium / slow download | Still streams progressively; UI notes audio conversions are slower; MP4/M4A/Opus/WebM are pure copies |
| Fragmented MP4 not accepted by some very old players | Low | Documented; all evergreen browsers, VLC, iOS/Android play fMP4 |
| Vercel Hobby non-commercial clause | Low | Personal project per spec assumptions |
