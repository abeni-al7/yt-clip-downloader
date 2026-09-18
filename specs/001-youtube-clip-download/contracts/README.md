# Contracts: YouTube Clip Download

**Feature**: `001-youtube-clip-download` | **Phase**: 1 | **Revision**: 2.1 (Render Free + Vercel Hobby, single user, no storage)

| File | Audience | Contents |
|------|----------|----------|
| [openapi.yaml](openapi.yaml) | Backend + `frontend/src/api/client.ts` | 3 endpoints, schemas, `ErrorCode` enum, streaming semantics |
| [ui-contract.md](ui-contract.md) | Frontend | Page states (incl. server-waking), validation, range selector, copy deck |

## Endpoint index

| Method | Path | Purpose | Backend module |
|--------|------|---------|----------------|
| POST | `/api/videos/resolve` | Canonicalise URL, return `VideoInfo` (title, duration, per-height variants with bitrates, start hint) | `api/videos.py` → `media/extractor.py`, `media/cache.py` |
| GET | `/api/clip` | Validate params, cut with ffmpeg, stream the file as an attachment | `api/clip.py` → `domain/format_plan.py`, `media/streamer.py`, `limits.py` |
| GET | `/api/health` | yt-dlp/ffmpeg/JS-runtime/stream-slot status; wake-up probe | `api/health.py` |

## Functional requirement coverage

| FR | Where it is satisfied |
|----|-----------------------|
| FR-001, FR-002 | `domain/youtube_url.py`; resolve 400 codes; UI `not_youtube`/`playlist_only` |
| FR-003 | `VideoInfo`; Video card |
| FR-004 | Timestamp grammar; `start_hint_s` prefill |
| FR-005 | data-model → Validation rules; UI clamping + inline messages |
| FR-006 | No max-duration rule; no stream timeout. *Deployment note*: very long clips can exhaust the 5 GB/month budget (spec Assumptions → Hosting budget) |
| FR-007, FR-008 | No identity, counters, auth or rate-limit middleware; `503 busy` is a capacity guard, not a quota |
| FR-009 | Download label shows selected duration; `SizeEstimate` from `VideoVariant.video_kbps` + `audio.*_kbps` |
| FR-010 | `OutputFormat`; Format picker (MP4 default) |
| FR-011 | `resolutions[mp4|webm]`; Quality picker hidden for audio; highest pre-selected |
| FR-012 | `format_plan.py` picks exactly the requested height (no fallback lower); stream copy |
| FR-013 | Stream copy — nothing drawn or inserted |
| FR-014 | ffmpeg `-ss` input seek + `-c copy` + `end+1 s` padding (R2) |
| FR-015 | `boundary_notice` near the range selector |
| FR-016 | `GET /api/clip` streams while cutting; headers sent on first ffmpeg chunk; browser download manager shows progress |
| FR-017 | `domain/filenames.py`; `Content-Disposition` |
| FR-018 | Input-side seek → HTTP Range reads; verified by quickstart S3 |
| FR-019 | `Error{code,message}` (R11), JSON or HTML by `Accept`; retry = click Download again |
| FR-020 | No database, no files, no job records; `media/streamer.py` pipes ffmpeg stdout directly; verified by quickstart S7 |
| FR-021 | `download_hint` copy shown after the click |
| FR-022 | Availability error codes from resolve/clip (R11) |
| FR-023 | Resolve cache (R4); *Make another clip* keeps the video loaded |
| FR-024 | Static SPA on evergreen browsers; responsive/accessible rules in ui-contract |

All 24 functional requirements are implemented as specified (spec amended 2026-09-18; see spec.md → Clarifications).
