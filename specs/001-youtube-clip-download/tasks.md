---

description: "Task list for feature 001 — YouTube Clip Download (Render Free + Vercel Hobby, stateless streaming)"
---

# Tasks: YouTube Clip Download

**Input**: Design documents from `/specs/001-youtube-clip-download/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec does not mandate TDD, but plan.md (Constitution Check → "Testability first") and research R17 make the offline test seam — `FakeExtractor` + synthetic media generated with ffmpeg + ffprobe assertions — part of the design. Test tasks therefore appear alongside the code they cover; they are not required to be written first.

**Organization**: Tasks are grouped by user story so each story is an independently testable increment. US1 alone is a usable product (MP4 at the highest available resolution).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1–US4, from spec.md)
- Every task names the exact file(s) it creates or edits

## Path Conventions

Web application per plan.md: `backend/src/ytclip/` (Python package), `backend/tests/`, `frontend/src/`, `frontend/tests/`, deployment manifests `render.yaml` (root) and `frontend/vercel.json`.

Key references: [plan.md](plan.md) (structure), [research.md](research.md) (R0–R17 decisions), [data-model.md](data-model.md) (models + validation rules), [contracts/openapi.yaml](contracts/openapi.yaml), [contracts/ui-contract.md](contracts/ui-contract.md) (states + copy deck), [quickstart.md](quickstart.md) (S0–S8 validation).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository skeleton, toolchains, container and deployment manifests

- [X] T001 Create the repository skeleton per plan.md: `backend/src/ytclip/__init__.py`, `backend/src/ytclip/{api,domain,media}/__init__.py`, `backend/tests/{unit,integration,live}/__init__.py`, `frontend/src/{api,lib,hooks,components,pages}/.gitkeep`, and a root `.gitignore` (Python venv/`__pycache__`/`.pytest_cache`/`.ruff_cache`, `node_modules`, `frontend/dist`, `.env*`, `!.env.example`)
- [X] T002 [P] Initialise the backend with uv in `backend/pyproject.toml`: project `ytclip` (`src` layout, `requires-python = ">=3.12"`), runtime deps `fastapi`, `uvicorn[standard]`, `pydantic>=2`, `yt-dlp[default]`; dev group `pytest`, `pytest-asyncio` (`asyncio_mode = "auto"`), `httpx`, `ruff`; pytest `markers = ["live: hits YouTube; run with YTCLIP_LIVE=1"]` and `addopts = "-m 'not live'"`; ruff config (line length 100, rules E/F/I/B/UP); then run `uv lock` to produce `backend/uv.lock`
- [X] T003 [P] Initialise the frontend in `frontend/package.json` (Vite 6, React 19, TypeScript 5, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, scripts `dev`/`build`/`preview`/`test`/`lint`), `frontend/tsconfig.json` (strict), `frontend/vite.config.ts` (dev proxy `/api` → `http://localhost:8000`, vitest `environment: jsdom`, `setupFiles`), `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/vite-env.d.ts` typing `VITE_API_BASE_URL` and `VITE_LARGE_DOWNLOAD_BYTES`, and `frontend/.env.example`
- [X] T004 [P] Write `backend/Dockerfile` per research R3/R16: `FROM python:3.12-slim`; `apt-get install -y --no-install-recommends ffmpeg ca-certificates`; `COPY --from=denoland/deno:bin /deno /usr/local/bin/deno`; `COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv`; `uv sync --frozen --no-dev` (dependency layer first, then `src/`); non-root `USER app`; `ENV PORT=10000 JS_RUNTIME=deno PYTHONUNBUFFERED=1`; `CMD ["sh","-c","uvicorn ytclip.main:app --host 0.0.0.0 --port ${PORT}"]`; plus `backend/.dockerignore` (tests, `.venv`, caches)
- [X] T005 [P] Write the deployment manifests: `render.yaml` (one `type: web`, `runtime: docker`, `plan: free`, `dockerfilePath: ./backend/Dockerfile`, `dockerContext: ./backend`, `healthCheckPath: /api/health`, env vars `ALLOWED_ORIGINS` and `FRONTEND_ORIGIN` with `sync: false`, `MAX_CONCURRENT_STREAMS: "2"`, `JS_RUNTIME: deno`, `PYTHONUNBUFFERED: "1"`) and `frontend/vercel.json` (`{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`)
- [X] T006 [P] Configure frontend linting in `frontend/eslint.config.js` (typescript-eslint recommended + `eslint-plugin-react-hooks`), `frontend/.prettierrc`, and `frontend/tests/setup.ts` (`@testing-library/jest-dom` matchers); confirm `npm run lint` and `npm test` run on the empty project

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, shared models, error handling, YouTube extraction seam, test fixtures, app factory, health endpoint and the SPA shell — everything every story needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T007 [P] Implement `backend/src/ytclip/config.py`: frozen dataclass `Settings` with `from_env()` reading `ALLOWED_ORIGINS` (comma list, default `http://localhost:5173`), `ALLOWED_ORIGIN_REGEX` (default `^https://.*\.vercel\.app$`), `FRONTEND_ORIGIN`, `MAX_CONCURRENT_STREAMS` (int, default 2), `JS_RUNTIME` (`deno`|`node`|`bun`|`quickjs`|empty), `YTDLP_COOKIES_FILE`, `YTDLP_PROXY`, `CACHE_TTL_S` (600), `CACHE_MAX_ENTRIES` (50), `PORT` (10000)
- [X] T008 [P] Implement `backend/src/ytclip/domain/models.py` per data-model.md and openapi.yaml: `OutputFormat` enum with `kind` (video/audio), `extension`, `content_type`; `ErrorCode` enum (all 18 codes); pydantic models `VideoVariant`, `AudioInfo`, `Resolutions`, `VideoInfo`, `ClipParams`, `ErrorBody`, `Health`
- [X] T009 Implement `backend/src/ytclip/api/errors.py` per research R9/R11: `ApiError(code, message=None, details=None, retry_after=None)`; `ERROR_TABLE: dict[ErrorCode, tuple[int, str]]` with the HTTP status and default user message for every code (400 request errors, 422 availability, 502 bot_check/extraction/processing, 503 busy); `register_handlers(app)` that returns JSON `{code,message,details}` unless the request `Accept` prefers `text/html` (browser navigation), in which case it returns a self-contained HTML page (inline CSS, message, "Back to the app" link to `settings.frontend_origin`, `<meta http-equiv="refresh" content="15">` only for `busy`) and sets `Retry-After` when provided
- [X] T010 Implement `backend/src/ytclip/limits.py`: `StreamSlots(max)` around `asyncio.Semaphore` with an async context manager `acquire_or_busy()` that raises `ApiError(ErrorCode.busy, retry_after=15)` when no slot is free, and properties `active`/`max`
- [X] T011 [P] Implement `backend/src/ytclip/media/cache.py`: `InfoCache(ttl_s, max_entries)` — `get(video_id)`/`put(video_id, info)` with monotonic-clock expiry and LRU eviction; pure in-memory (research R4)
- [X] T012 Implement `backend/src/ytclip/media/extractor.py` per research R3/R11: `Extractor` Protocol (`async def resolve(video_id: str) -> dict`); `YtDlpExtractor(settings)` running `yt_dlp.YoutubeDL(opts).extract_info(canonical_url, download=False)` via `asyncio.to_thread` with opts `quiet`, `no_warnings`, `skip_download`, `noplaylist`, `cachedir: False`, `cookiefile`/`proxy` from settings, and the JS-runtime option derived from `JS_RUNTIME` (translate `--js-runtimes <name>` with `python -m yt_dlp` `devscripts/cli_to_api.py` semantics — verify the exact `YoutubeDL` key against the installed yt-dlp); `classify_error(exc) -> ErrorCode` implementing the R11 message-pattern table with fallback `extraction_failed`; `check_availability(info)` raising `live_in_progress` for `live_status ∈ {is_live, is_upcoming, post_live}` and `drm_protected` when all formats carry `has_drm`
- [X] T013 Implement `backend/src/ytclip/media/fakes.py`: `FakeExtractor(media_dir, *, fail_with: str | None = None, no_audio: bool = False)` returning a yt-dlp-shaped info dict (`id`, `title`, `channel`, `duration`, `thumbnails`, `playable_in_embed`, `live_status: not_live`, `formats[]` with `format_id`, `url` = local file path, `protocol: "https"`, `vcodec`/`acodec`, `height`, `fps`, `tbr`, `ext`, `http_headers: {}`) built from the synthetic files; `fail_with` raises an exception whose message matches an R11 pattern (e.g. `"Private video"`)
- [X] T014 Implement `backend/tests/conftest.py`: session-scoped `synthetic_media` fixture that generates into `tmp_path_factory` with ffmpeg lavfi — 120 s video-only MP4s at 1080p and 720p (`-c:v libx264 -g 48 -keyint_min 48`, i.e. a keyframe every 2 s at 24 fps), a 120 s video-only VP9 WebM at 720p, a 120 s AAC `.m4a` and a 120 s Opus `.webm` audio (`-f lavfi -i sine`), skipping the whole suite if `ffmpeg` is not on `PATH`; `settings` fixture (`MAX_CONCURRENT_STREAMS=2`, `FRONTEND_ORIGIN=http://localhost:5173`); `app`/`client` fixtures building the app with `FakeExtractor` and `httpx.AsyncClient(transport=ASGITransport(app))`; `ffprobe_json(bytes)` helper that writes bytes to a temp file and returns parsed `ffprobe -show_format -show_streams -of json`
- [X] T015 Implement `backend/src/ytclip/api/health.py`: `GET /api/health` returning the `Health` schema — `yt_dlp_version` (`yt_dlp.version.__version__`), `ffmpeg.{available,version}` (probe `ffmpeg -version` once at startup), `js_runtime.{name,available}` (`shutil.which` for the configured runtime), `streams.{active,max}` from `StreamSlots`, `rss_mb` from `resource.getrusage`, `status: ok|degraded` (degraded when ffmpeg or the JS runtime is missing); `Cache-Control: no-store`
- [X] T016 Implement `backend/src/ytclip/main.py`: `create_app(settings=None, extractor=None) -> FastAPI` storing `settings`, `InfoCache`, `StreamSlots`, and the extractor on `app.state`; `CORSMiddleware` with `allow_origins=settings.allowed_origins`, `allow_origin_regex`, methods `GET, POST, OPTIONS`, headers `Content-Type`; `register_handlers(app)`; include the health router (video/clip routers are added in US1); module-level `app = create_app()` for uvicorn
- [X] T017 [P] Implement the frontend API layer and shared helpers: `frontend/src/api/client.ts` (`API_BASE` from `import.meta.env.VITE_API_BASE_URL`, `ApiError {code,message,details,status}`, `health(signal)`, `resolve(url, signal)` with 120 s timeout via `AbortController`, `clipUrl({v,start,end,format,height})` building the `GET /api/clip` URL), `frontend/src/lib/format.ts` (`formatDuration(s)` → `"30 s"`/`"1 h 12 min"`, `formatBytes(n)`, `toHms(s)` → `HH:MM:SS`), `frontend/src/hooks/useServerStatus.ts` (health ping on mount with 90 s timeout; states `booting|waking|ready|down`; `waking` after 3 s without answer; `retry()`), and `frontend/src/components/ServerStatusBanner.tsx` rendering `server_waking`/`server_down` copy from ui-contract with a Retry button
- [X] T018 Implement the SPA shell: `frontend/src/App.tsx` (renders `ServerStatusBanner` + `HomePage`; no router), `frontend/src/pages/HomePage.tsx` skeleton with the `Booting|Waking|Idle|Resolving|Loaded|Downloading|UrlError` state type from ui-contract and placeholder sections in contract order, `frontend/src/components/ErrorMessage.tsx` (role="alert"), and `frontend/src/styles.css` (single-column layout, 360 px minimum width, focus-visible styles, no hover-only affordances — FR-024)

**Checkpoint**: `uv run pytest` runs (fixtures generate media), `GET /api/health` answers, `npm run dev` shows the shell with the server-status banner

---

## Phase 3: User Story 1 - Cut and Download a Clip (Priority: P1) 🎯 MVP

**Goal**: Paste a public YouTube URL, type a start/end, press Download, receive an MP4 (highest available resolution) that fully contains the segment — no account, quota or duration limit; nothing stored on the server.

**Independent Test**: Paste a public YouTube URL, enter `00:01:00` → `00:01:30`, press Download; the browser downloads `<title> [00-01-00-00-01-30].mp4`, `ffprobe` duration is 30–40 s, no sign-in/payment/quota prompt appears (quickstart S1). Offline: `backend/tests/integration/test_clip_mp4.py` passes.

### Backend for User Story 1

- [X] T019 [P] [US1] Implement `backend/src/ytclip/domain/youtube_url.py` per research R12: `parse_youtube_url(text) -> ParsedUrl(video_id, start_hint_s)` accepting hosts `youtube.com`, `www.`, `m.`, `music.`, `youtube-nocookie.com`, `youtu.be` (scheme optional), shapes `/watch?v=ID`, `youtu.be/ID`, `/shorts/ID`, `/live/ID`, `/embed/ID`, `/v/ID`, and a bare 11-char ID; `ID = [A-Za-z0-9_-]{11}`; start hint from `t`/`start` query or `#t=` fragment (`90`, `90s`, `1m30s`, `1h2m3s`); ignore `list=` when a video ID is present; `/playlist?list=` alone → `ApiError(playlist_only)`; anything else → `ApiError(invalid_url)`; `canonical_url(video_id)`
- [X] T020 [P] [US1] Implement `backend/src/ytclip/domain/timestamps.py`: `parse_timestamp(value: str | int) -> int` for the grammar in data-model.md (`SS`, `MM:SS`, `HH:MM:SS`, `[Nh][Nm][Ns]`; `MM`/`SS` may exceed 59 in the `MM:SS`/`SS` forms; whitespace trimmed) raising `ValueError` on anything else; `format_hms(seconds) -> "HH:MM:SS"`; `format_hms_for_filename(seconds) -> "HH-MM-SS"`
- [X] T021 [P] [US1] Implement `backend/src/ytclip/domain/estimate.py` per research R2/R8: `usable_formats(info)` keeping `protocol == "https"` (fallback to `m3u8_native` only when no https formats exist); `build_resolutions(info) -> Resolutions` with one `VideoVariant` per height per container (`mp4`: any codec, preference `avc1 › vp9 › av01`; `webm`: `vp9 › av01` only), descending, `video_kbps` from `vbr`/`tbr`; `build_audio(info) -> AudioInfo` (best `m4a`/AAC kbps and best Opus kbps); `has_audio(info)`; `pick_video_format(info, container, height)` and `pick_audio_format(info, container)` returning the yt-dlp format dicts the plan will use
- [X] T022 [US1] Implement `backend/src/ytclip/domain/format_plan.py` (MP4 only in this story) per research R2: `build_plan(info, params) -> FfmpegPlan(argv, content_type, extension, video_format_id, audio_format_id)`; argv = `ffmpeg -hide_banner -loglevel error -nostdin -reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1 -reconnect_delay_max 30 [-headers "<k: v\r\n…>"] -ss START -to END+1 -i <video_url> [-headers …] -ss START -to END+1 -i <audio_url> -map 0:v:0 -map 1:a:0 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1` (when the chosen video format already contains audio, use `-map 0:a:0` and a single input); header values are built from each format's `http_headers` with CR/LF stripped; raise `ApiError(unsupported_resolution)` when `height` is not offered for the container and `ApiError(no_audio_track)` when no audio format exists
- [X] T023 [P] [US1] Implement `backend/src/ytclip/domain/filenames.py` per research R14: `download_filename(title, start_s, end_s, extension)` → `"{title} [{HH-MM-SS}-{HH-MM-SS}].{ext}"` using `yt_dlp.utils.sanitize_filename` and trimming the title to 120 chars; `content_disposition(filename)` → `attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`
- [X] T024 [P] [US1] Implement `backend/src/ytclip/media/streamer.py` per research R6: `class FfmpegStream` with `async start()` that spawns `asyncio.create_subprocess_exec(*argv, stdout=PIPE, stderr=PIPE)`, drains stderr into a bounded `deque` (last 4 KiB), and waits for the **first 64 KiB chunk** — raising `ProcessingFailed(stderr_tail)` if the process exits non-zero before producing any output; `async def chunks()` yielding the buffered first chunk then subsequent 64 KiB reads until EOF; `async def close()` sending `SIGTERM` then `SIGKILL` after 5 s; `chunks()` calls `close()` in `finally` so client disconnects (`CancelledError`/`GeneratorExit`) always kill ffmpeg; log the stderr tail on non-zero exit
- [X] T025 [US1] Implement `backend/src/ytclip/api/videos.py`: `POST /api/videos/resolve` — body `{url}`; `parse_youtube_url` (400 codes via `ApiError`); `InfoCache.get` or `extractor.resolve` (wrap failures with `classify_error` → `ApiError` with 422/502 per `ERROR_TABLE`); `check_availability`; assemble `VideoInfo` (`title`, `channel`, `thumbnail_url` = largest thumbnail, `duration_s`, `embeddable = playable_in_embed`, `has_audio`, `resolutions`, `audio`, `start_hint_s`); `InfoCache.put`; register the router in `main.py`
- [X] T026 [US1] Implement `backend/src/ytclip/api/clip.py`: `GET /api/clip` — parse `v` (`parse_youtube_url`), `start`/`end` (`parse_timestamp`, 400 `invalid_range` on parse failure), `format`, `height` into `ClipParams`; enforce data-model validation rules in order (`0 ≤ start`, `end − start ≥ 1`, `end ≤ duration_s` after the info is known, `height` required for video formats and `∈ resolutions[format]`); `StreamSlots.acquire_or_busy()`; info from cache or extractor (same error mapping as resolve); `build_plan`; `FfmpegStream.start()` (map `ProcessingFailed` → `ApiError(processing_failed)` — headers have not been sent yet); return `StreamingResponse(stream.chunks(), media_type=plan.content_type, headers={Content-Disposition, Cache-Control: no-store, X-Clip-Start-Requested, X-Clip-End-Requested})`; release the slot when the generator finishes or is cancelled; register the router in `main.py`
- [X] T027 [P] [US1] Write unit tests: `backend/tests/unit/test_youtube_url.py` (every accepted URL shape, `t=` variants, `list=` handling, playlist-only, garbage, bare ID), `backend/tests/unit/test_timestamps.py` (grammar table incl. `1:65` → 125, `65` → 65, `1h5m` → 3900, rejects `1:2:3:4`/`abc`), `backend/tests/unit/test_filenames.py` (sanitisation, 120-char trim, RFC 5987 header for a Unicode title), `backend/tests/unit/test_format_plan.py` (MP4 argv contains `-ss`/`-to END+1` before each `-i`, `-c copy`, fMP4 flags, `pipe:1`; exact-height selection never falls back lower; `unsupported_resolution`; CR/LF stripped from headers), `backend/tests/unit/test_errors.py` (each R11 message pattern → code; unknown → `extraction_failed`; `ERROR_TABLE` covers every `ErrorCode`)
- [X] T028 [US1] Write `backend/tests/integration/test_clip_mp4.py` using the `client` fixture: `POST /api/videos/resolve` returns `VideoInfo` with `resolutions.mp4 == [1080, 720]` heights and `has_audio` true; `GET /api/clip?v=<fake id>&start=10&end=40&format=mp4&height=720` → 200, `Content-Type: video/mp4`, `Content-Disposition` contains `[00-00-10-00-00-40].mp4`, `ffprobe_json` shows `format.duration` in `[30, 40]`, video stream `height == 720` and `codec_name == "h264"`, audio `codec_name == "aac"`; `start=00:00:10&end=00:00:40` (timestamp strings) behaves identically; `end<=start` → 400 `invalid_range`; `v=https://example.com/x` → 400 `invalid_url`; `v=https://www.youtube.com/playlist?list=PLx` → 400 `playlist_only`; `height=480` → 400 `unsupported_resolution`; `FakeExtractor(fail_with="Private video")` → resolve 422 `private`; `Accept: text/html` on a 400 → HTML body containing "Back to the app"; with `MAX_CONCURRENT_STREAMS=1` a second concurrent request → 503 `busy` with `Retry-After`; cancelling the response iterator mid-stream leaves no running `ffmpeg` child within 6 s and `health.streams.active == 0`

### Frontend for User Story 1

- [X] T029 [P] [US1] Implement the client mirrors `frontend/src/lib/youtubeUrl.ts` (`parseYoutubeUrl(text) → {videoId, startHintS} | {error: "not_youtube" | "playlist_only"}`, same rules as T019) and `frontend/src/lib/timestamps.ts` (`parseTimestamp(text) → number | null`, `toHms`, same grammar as T020), with tests `frontend/tests/lib/youtubeUrl.test.ts` and `frontend/tests/lib/timestamps.test.ts` mirroring the backend cases
- [X] T030 [P] [US1] Implement `frontend/src/components/UrlInput.tsx`: text input + submit (Enter/paste auto-submits when the text parses); instant client validation showing `not_youtube`/`playlist_only`; calls `resolve()` and reports `Resolving`/`Loaded`/`UrlError`; server errors show `ApiError.message` with `try_again_suffix` appended for `bot_check`/`extraction_failed`; disabled while the server status is not `ready`
- [X] T031 [P] [US1] Implement `frontend/src/components/VideoCard.tsx`: thumbnail (`alt` = title), title, channel, total duration via `toHms` (FR-003)
- [X] T032 [P] [US1] Implement `frontend/src/components/TimestampField.tsx`: labelled text input that parses on blur/Enter with `parseTimestamp`, shows `bad_timestamp` inline when unparseable, renders the canonical `HH:MM:SS` when valid, and has `−1 s`/`+1 s` nudge buttons with `aria-label`s
- [X] T033 [P] [US1] Implement `frontend/src/components/BoundaryNotice.tsx` (renders `boundary_notice`, FR-015), `frontend/src/lib/estimate.ts` (`estimateBytes({durationS, videoKbps, audioKbps})` per data-model → Size estimate, with the 3 % overhead factor) and `frontend/src/components/SizeEstimate.tsx` (renders `size_estimate` and adds `large_download_note` when `≥ VITE_LARGE_DOWNLOAD_BYTES`, default 500 MB — FR-009), with `frontend/tests/lib/estimate.test.ts`
- [X] T034 [US1] Implement `frontend/src/components/DownloadButton.tsx`: an `<a target="_blank" rel="noopener">` styled as the primary button with label `Download {formatDuration(end−start)} clip`; `href = clipUrl(params)` only when the form is valid and the server is `ready`, otherwise rendered as a disabled button with the blocking reason; `onClick` notifies the page so it can enter `Downloading`
- [X] T035 [P] [US1] Implement `frontend/src/components/DownloadHint.tsx`: shows `download_hint` and `download_failed_hint` after a click (FR-021) and a "Make another clip" button that resets range only, keeping the video loaded (FR-023)
- [X] T036 [US1] Wire `frontend/src/pages/HomePage.tsx` for the MP4 flow: state `{status, url, video, startS, endS, downloaded}`; on `Loaded` pre-fill `startS` from `start_hint_s` and `endS = duration_s`; validation rules from ui-contract (`end ≤ start` → `end_before_start` + button disabled; `end > duration` → clamp + `end_clamped`; `start < 0` → clamp); format fixed to `mp4` and `height = resolutions.mp4[0].height` for this story; estimate from that variant + `audio.m4a_kbps`; render `VideoCard`, two `TimestampField`s, `BoundaryNotice`, `SizeEstimate`, `DownloadButton`, `DownloadHint` in contract order; a different URL resets to `Resolving`
- [X] T037 [US1] Write `frontend/tests/HomePage.test.tsx` with a mocked `fetch`: health ok → banner hidden; paste a `youtu.be/…?t=60` link → card shows title/duration and start field shows `00:01:00`; type an end before start → button disabled and `end_before_start` visible; type `00:01:30` → anchor `href` contains `start=60&end=90&format=mp4&height=1080`; a `422 {code:"private"}` from resolve → message shown; health never answering → `server_waking` banner after 3 s and button disabled

**Checkpoint**: MVP — a user can cut and download an MP4 clip end to end (quickstart S0, S1, S3, S7, S8 pass)

---

## Phase 4: User Story 2 - Choose the Output Format (Priority: P2)

**Goal**: Offer MP4, WebM, MP3, M4A, OGG and Opus; audio formats are audio-only and reject a resolution; videos without audio cannot produce audio formats.

**Independent Test**: Select MP3, download a 20 s clip → the file is audio-only MP3 of ~20 s that plays in a standard player; repeat for WebM/M4A/OGG/Opus (quickstart S2). Offline: `backend/tests/integration/test_clip_formats.py` passes.

- [ ] T038 [US2] Extend `backend/src/ytclip/domain/format_plan.py` with the remaining formats per research R2 table: WebM (`vp9`/`av01` video at `height` + best Opus audio, `-c copy -f webm`), M4A (`-vn -c:a copy -movflags frag_keyframe+empty_moov+default_base_moof -f mp4`, `audio/mp4`), Opus (`-vn -c:a copy -f opus`, `audio/ogg`), MP3 (`-vn -c:a libmp3lame -q:a 2 -f mp3`, `audio/mpeg`), OGG (`-vn -c:a libvorbis -q:a 6 -f ogg`, `audio/ogg`); audio formats take a single audio input; `OutputFormat.content_type`/`extension` already drive headers
- [ ] T039 [US2] Extend validation in `backend/src/ytclip/api/clip.py`: audio formats with a `height` → 400 `unsupported_resolution` (details `{"field":"height"}`); audio formats when `has_audio` is false → 400 `no_audio_track`; WebM requires `height ∈ resolutions.webm` and returns `unsupported_format` details when `resolutions.webm` is empty
- [ ] T040 [P] [US2] Extend `backend/tests/unit/test_format_plan.py`: argv assertions for each of the five new formats (codec flags, muxer, `-vn`, single input), audio + height rejection, `no_audio_track` when the info has no audio formats, WebM refuses `avc1`-only heights
- [ ] T041 [US2] Write `backend/tests/integration/test_clip_formats.py`: for each format download `start=10&end=30` from the fake video and assert via `ffprobe_json` — `mp3` → one stream `audio/mp3`; `m4a` → `audio/aac`; `ogg` → `audio/vorbis`; `opus` → `audio/opus`; `webm&height=720` → `video/vp9` + `audio/opus`; `mp4&height=720` → `video/h264` + `audio/aac`; every duration in `[20, 30]`; `Content-Disposition` extension matches; `format=mp3&height=720` → 400 `unsupported_resolution`; `FakeExtractor(no_audio=True)` + `format=mp3` → 400 `no_audio_track`; `format=flac` → 400 `unsupported_format`
- [ ] T042 [P] [US2] Implement `frontend/src/components/FormatPicker.tsx`: radio group in two labelled groups *Video* (MP4 default, WebM) and *Audio* (MP3, M4A, OGG, Opus), each option labelled with its kind (US2 scenario 1); WebM disabled with a hint when `resolutions.webm` is empty; audio options disabled with `no_audio` when `has_audio` is false; `audio_convert_note` under MP3/OGG
- [ ] T043 [US2] Wire the format into `frontend/src/pages/HomePage.tsx` and `frontend/src/lib/estimate.ts`: `format` state (default `mp4`), `clipUrl` omits `height` for audio formats, estimate uses `audio.m4a_kbps` for mp4/m4a, `audio.opus_kbps` for webm/opus, fixed 190 kbps for mp3/ogg and `videoKbps = 0` for audio formats; add `frontend/tests/FormatPicker.test.tsx` (default MP4; selecting MP3 removes `height` from the anchor `href`; WebM disabled when unavailable; audio disabled without audio)

**Checkpoint**: All six formats download correctly; US1 still passes unchanged

---

## Phase 5: User Story 3 - Visually Select the Time Range (Priority: P3)

**Goal**: Dual-handle range slider synchronised with the typed fields, keyboard/touch friendly, 1-second precision on very long videos, and an in-page preview that plays exactly the selected segment.

**Independent Test**: Load a video; drag the start handle → the start field updates and the preview seeks; type an end time → the end handle moves; press *Preview selection* → playback runs start→end and pauses; on a 10-hour video reach `05:00:01` with zoom + nudge; a handle drag works with touch emulation (quickstart S5).

- [ ] T044 [P] [US3] Implement `frontend/src/components/RangeSelector.tsx`: two native `<input type="range">` handles for `start`/`end` over the visible window (default `[0, durationS]`); handles cannot cross (`other ± 1`); keyboard steps ←/→ 1 s, Shift 10 s, PageUp/PageDown 60 s; `aria-label`s and `aria-valuetext = toHms(value)`; a zoom control (window sizes *whole video* / *30 min* / *5 min* / *1 min* centred on the selection) that changes only the visible window, never the values; emits `onChange({startS, endS})` and `onScrub(seconds)` while dragging
- [ ] T045 [P] [US3] Implement `frontend/src/hooks/useYouTubePlayer.ts`: load `https://www.youtube.com/iframe_api` once, create a muted `YT.Player` for `videoId` in a container ref, expose `seekTo`, `play`, `pause`, `unmute`, `ready`; `playRange(startS, endS)` seeks, plays, and polls `getCurrentTime()` every 250 ms to `pauseVideo()` at `≥ endS`; clear timers and destroy the player on unmount
- [ ] T046 [US3] Implement `frontend/src/components/PreviewPlayer.tsx`: renders the player container only when `video.embeddable` is true; *Preview selection* button calls `playRange(startS, endS)`; an unmute control; `seekTo(startS)` (debounced 200 ms) when the start handle scrubs
- [ ] T047 [US3] Integrate `RangeSelector` and `PreviewPlayer` into `frontend/src/pages/HomePage.tsx` (slider above the two `TimestampField`s; both directions stay in sync; typed values move handles on blur/Enter) and write `frontend/tests/RangeSelector.test.tsx` (changing the start input updates the start field; setting `endS` prop moves the end handle; handles cannot cross; Shift+ArrowRight adds 10 s; zoom changes the visible min/max but not the values)

**Checkpoint**: Range can be chosen visually and previewed; typed entry from US1 still works

---

## Phase 6: User Story 4 - Choose Quality / Resolution (Priority: P4)

**Goal**: For video formats, pick from the resolutions actually available for the video (highest pre-selected); hidden for audio formats; the delivered clip is exactly the chosen resolution.

**Independent Test**: On a video offering 1080p and 720p, select 720p and download → `ffprobe` height is 720; the picker disappears when an audio format is selected (quickstart S6). Offline: `backend/tests/integration/test_clip_quality.py` passes.

- [ ] T048 [P] [US4] Implement `frontend/src/components/QualityPicker.tsx`: lists `resolutions[format]` heights descending as `2160p`, `1440p`, … with the highest pre-selected (FR-011); rendered only for `mp4`/`webm`; shows `mp4_hi_res_note` when `format === "mp4"` and the selected variant's `vcodec !== "avc1"`
- [ ] T049 [US4] Wire `height` into `frontend/src/pages/HomePage.tsx`: `height` state resets to the highest available whenever the video or a video format changes and is `null` for audio formats; `clipUrl` and `SizeEstimate` use the selected `VideoVariant.video_kbps`; add `frontend/tests/QualityPicker.test.tsx` (highest pre-selected; choosing 720 changes the anchor `href` to `height=720`; hidden for `mp3`; note shown for a `vp9` 2160p MP4 variant)
- [ ] T050 [US4] Write `backend/tests/integration/test_clip_quality.py`: `format=mp4&height=720` → `ffprobe` video `height == 720`; `height=1080` → `1080`; `height=480` (not offered) → 400 `unsupported_resolution`; `format=webm&height=1080` when only a 720p VP9 stream exists → 400 `unsupported_resolution` (never falls back lower — FR-012/SC-004)

**Checkpoint**: All four user stories work independently and together

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Live verification against YouTube, documentation, hardening, deployment validation

- [ ] T051 [P] Write `backend/tests/live/test_live_youtube.py` (marker `live`, skipped unless `YTCLIP_LIVE=1`): resolve a known public video and assert `duration_s > 0` and non-empty `resolutions.mp4`; download a 20 s MP4 at the lowest offered height and a 20 s MP3, asserting `ffprobe` duration in `[20, 30]` and the expected codecs
- [ ] T052 [P] Write the root `README.md`: what the tool does and does not do (no accounts, no limits, nothing stored), local run (two terminals + Docker), deploy to Render via `render.yaml` and to Vercel (root directory `frontend`, `VITE_API_BASE_URL`), environment variable table, the 5 GB/month bandwidth and ~60 s cold-start notes, bot-check troubleshooting (`YTDLP_COOKIES_FILE` secret file at the operator's own risk, `YTDLP_PROXY`), and a link to `specs/001-youtube-clip-download/quickstart.md`
- [ ] T053 [P] Add structured request logging in `backend/src/ytclip/api/clip.py` and `backend/src/ytclip/media/streamer.py`: one log line per clip request with `video_id`, `start`, `end`, `format`, `height`, `bytes_sent`, `elapsed_s`, `outcome` (`completed|client_disconnected|failed`) and the ffmpeg stderr tail on failure — logging only, nothing persisted (FR-020)
- [ ] T054 [P] Security hardening pass per plan.md → Constraints and research R12: only `canonical_url(video_id)` is ever passed to yt-dlp and only extractor-supplied format URLs to ffmpeg (SSRF); reject query values over 2 KB; strip CR/LF from all header values; ffmpeg argv built as a list (never a shell string); CORS restricted to configured origins; container runs as non-root; document the findings as comments where non-obvious in `backend/src/ytclip/api/clip.py`, `backend/src/ytclip/domain/format_plan.py`, `backend/Dockerfile`
- [ ] T055 [P] Accessibility and responsive polish per ui-contract → Accessibility (FR-024) in `frontend/src/styles.css` and the components: logical focus order (URL → card → range → fields → format → quality → download), visible focus rings, no colour-only notes, single column below 768 px, usable at 360 px; verify with keyboard-only navigation and a 360 px viewport
- [ ] T056 Run the backend quality gate and the local quickstart scenarios: `cd backend && uv run ruff check . && uv run pytest`, `cd frontend && npm run lint && npm test && npm run build`, `docker build -t ytclip backend`, then quickstart S1–S4, S6, S7 (`docker diff` shows no new files after a download) and S8 step 2 against the local container
- [ ] T057 Deploy and validate on the free tiers per quickstart → Deploy: apply `render.yaml` as a Render Blueprint, set `ALLOWED_ORIGINS`/`FRONTEND_ORIGIN`, create the Vercel project (root `frontend`, `VITE_API_BASE_URL`), run the post-deploy checks (`/api/health` cold and warm, CORS preflight from the Vercel origin), then **S0 (bot-check go/no-go)**, S1, S2 and S8 step 1 against the deployed URLs; if S0 returns `bot_check`, record the outcome and the chosen mitigation in the root `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately; T002–T006 in parallel after T001
- **Foundational (Phase 2)**: Depends on Setup — **blocks all user stories**
- **User Stories (Phases 3–6)**: All depend on Foundational completion; then proceed in priority order (US1 → US2 → US3 → US4) or in parallel where noted below
- **Polish (Phase 7)**: Depends on the user stories being complete (T056/T057 need everything; T051–T055 can start once US1 is done)

### User Story Dependencies

- **US1 (P1)**: Only Foundational. Delivers the MVP on its own.
- **US2 (P2)**: Extends `format_plan.py`, `api/clip.py` and `HomePage.tsx` from US1 → start after US1's T022, T026 and T036 are complete.
- **US3 (P3)**: Frontend only; touches `HomePage.tsx` → start after US1's T036. Independent of US2 and US4.
- **US4 (P4)**: Frontend picker + backend tests; touches `HomePage.tsx` → start after US1's T036; backend behaviour already exists from T022. Independent of US2 (height only applies to video formats) and US3.

### Within Each User Story

- Pure domain modules (`domain/*`) before API routes; API routes before integration tests
- Components before the `HomePage.tsx` wiring task; wiring before the page test
- A story is complete when its checkpoint scenario in quickstart.md passes

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005, T006 together after T001
- Phase 2: T007, T008, T011 together; T017 (frontend) in parallel with all backend foundational work; T018 after T017
- US1 backend: T019, T020, T021, T023, T024 together; then T022; then T025 and T026; T027 alongside T024–T026; T028 last
- US1 frontend (in parallel with US1 backend): T029, T030, T031, T032, T033, T035 together; then T034; then T036; then T037
- US2: T040 and T042 in parallel with T038/T039
- US3: T044 and T045 together, then T046, then T047
- US4: T048 in parallel with T050; then T049
- Polish: T051–T055 together; then T056; then T057

---

## Parallel Example: User Story 1

```bash
# Backend, wave 1 — pure modules, no shared files:
T019 domain/youtube_url.py | T020 domain/timestamps.py | T021 domain/estimate.py | T023 domain/filenames.py | T024 media/streamer.py
# Backend, wave 2:
T022 domain/format_plan.py  →  T025 api/videos.py + T026 api/clip.py  →  T028 integration test
# Frontend, in parallel with the backend waves:
T029 lib mirrors | T030 UrlInput | T031 VideoCard | T032 TimestampField | T033 BoundaryNotice+SizeEstimate | T035 DownloadHint
  →  T034 DownloadButton  →  T036 HomePage wiring  →  T037 HomePage test
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) → Phase 2 (Foundational)
2. Phase 3 (US1): MP4 at the highest available resolution, typed timestamps, streaming download
3. **STOP and validate**: quickstart S0 on Render first (bot-check go/no-go), then S1, S3, S7, S8
4. Deploy to Render + Vercel (T057 can be run early for the MVP) — the tool is already useful

### Incremental Delivery

1. US1 → MVP deployed
2. US2 → six formats (backend + picker)
3. US3 → slider + preview
4. US4 → quality picker
5. Polish → live tests, README, hardening, final deploy validation

Each story leaves the previous ones working; every phase ends with an independently verifiable checkpoint.

### Notes

- Tasks marked [P] touch different files and have no dependency on an incomplete task in the same wave
- The `FakeExtractor` + synthetic-media fixtures (T013/T014) let every backend test run offline; only `tests/live/` touches YouTube
- Nothing may be written to disk or retained on the server at any point (FR-020) — T056's `docker diff` check enforces this
- Commit after each task or logical group; stop at any checkpoint to validate independently
