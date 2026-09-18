# Feature Specification: YouTube Clip Download

**Feature Branch**: `001-youtube-clip-download`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "I want you to spec out the feature of https://www.clipscutter.com/cutter/GlmMxmWHEfg. I don't want the authentication and the paid features. I only want the clip downloading functionality without any limits regarding duration."

## Clarifications

### Session 2026-09-18

- Q: Must clip boundaries land exactly on the requested timestamps, or may they snap outward to the nearest natural cut point? → A: Snap outward to the nearest natural cut point; original quality is preserved (Option B).
- Q: Given free-tier hosting with no persistent storage, can "leave and come back" (background processing, 24-hour retention, clip links, recent-clips list) be dropped? → A: Yes — dropped. Nothing is stored anywhere on the server; the clip is produced while it downloads.
- Q: Would a frontend-only implementation be acceptable if it worked? → A: Yes in principle, but it is not technically possible (a web page cannot read YouTube media cross-origin), so a minimal stateless backend is kept.
- Q: Audience and scope? → A: A single user; only the end-to-end flow of choosing a segment and downloading it without downloading the whole video.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cut and Download a Clip (Priority: P1)

A visitor pastes the link of a public YouTube video, enters a start time and an end time, and receives a downloadable video file that contains only that segment. No account, sign-in, or payment is involved, and the segment may be any length — up to and including the entire video.

**Why this priority**: This is the whole reason the product exists. Every other story refines this flow; without it nothing else has value.

**Independent Test**: Paste a public YouTube URL, enter `00:01:00` → `00:01:30`, press Download, and confirm the browser downloads an MP4 that fully contains that segment (roughly 30 seconds, possibly a few seconds longer) — with no sign-in, payment, or quota prompts at any point.

**Acceptance Scenarios**:

1. **Given** the landing page, **When** the user pastes a valid public YouTube video URL, **Then** the video's title, thumbnail, and total duration are displayed and the time-range and Download controls become available.
2. **Given** a loaded video, **When** the user sets start `00:01:00`, end `00:01:30`, and presses Download, **Then** the browser's download begins within a few seconds and the saved video clip fully contains that segment.
3. **Given** a loaded 3-hour video, **When** the user sets start `00:00:00` and end `03:00:00`, **Then** the download is accepted and runs to completion — no duration ceiling is applied.
4. **Given** a loaded video, **When** the user enters an end time that is earlier than or equal to the start time, **Then** Download is unavailable and an inline message explains why.
5. **Given** a loaded video, **When** the user enters an end time later than the video's total duration, **Then** the value is clamped to the video's duration and the user is informed of the adjustment.
6. **Given** a link that is not a YouTube video URL, **When** the user submits it, **Then** a plain-language message explains that only YouTube video links are supported.
7. **Given** a private, removed, members-only, or sign-in-required (age-restricted) video URL, **When** the user submits it, **Then** a plain-language message explains the video cannot be processed because it is not publicly accessible.
8. **Given** a download that cannot be produced (e.g., the video has become unavailable), **When** the user presses Download, **Then** the user sees a specific, plain-language reason and can simply try again.
9. **Given** a user who has already downloaded one or more clips today, **When** they download another clip from the same or a different video, **Then** it is accepted — no per-day, per-video, or per-device quota exists.

---

### User Story 2 - Choose the Output Format (Priority: P2)

Before downloading a clip, the user selects the output format: a video format (MP4 or WebM) or an audio-only format (MP3, M4A, OGG, or Opus).

**Why this priority**: Format choice — especially audio-only extraction for music, podcasts, and interviews — is the reference tool's main differentiator after cutting itself, and it broadens the use cases substantially.

**Independent Test**: Load a video, select MP3, download a 20-second clip, and verify the downloaded file is audio-only, in MP3, approximately 20 seconds long, and plays in a standard media player.

**Acceptance Scenarios**:

1. **Given** a loaded video, **When** the user opens the format selector, **Then** MP4, WebM, MP3, M4A, OGG, and Opus are offered, with MP4 pre-selected and each option labelled as video or audio.
2. **Given** MP3 is selected, **When** the clip is downloaded, **Then** the downloaded file is audio-only, in MP3, and fully contains the requested range.
3. **Given** WebM is selected, **When** the clip is downloaded, **Then** the downloaded file is a WebM video with sound and fully contains the requested range.
4. **Given** any format is selected, **When** the download completes, **Then** the file's extension matches the chosen format.
5. **Given** an audio-only format is selected for a source video that has no audio track, **When** the user presses Download, **Then** a plain-language message explains that the video has no audio to extract.

---

### User Story 3 - Visually Select the Time Range (Priority: P3)

Instead of typing timestamps, the user scrubs a preview of the video and drags start and end handles on a range slider. Typed and dragged values stay in sync, and the user can preview exactly the selected segment before downloading the clip.

**Why this priority**: Dramatically improves precision and ease of use, but the core flow already works with typed timestamps, so this can follow.

**Independent Test**: Load a video, drag the start handle and confirm the start field updates; type an end time and confirm the end handle moves; press "Preview selection" and confirm playback runs from start to end and stops.

**Acceptance Scenarios**:

1. **Given** a loaded video, **When** the user drags the start handle, **Then** the start timestamp field updates live and the preview seeks to that position.
2. **Given** a loaded video, **When** the user types a timestamp in either field, **Then** the corresponding slider handle moves to match.
3. **Given** a start and end are set, **When** the user presses "Preview selection", **Then** playback begins at the start time and stops at the end time.
4. **Given** a very long video (e.g., 10 hours), **When** the user adjusts a handle, **Then** second-level precision remains achievable (e.g., via nudge controls or a zoomed range).
5. **Given** the user is on a touch device, **When** they drag a handle, **Then** the slider responds to touch as it does to a mouse.

---

### User Story 4 - Choose Quality / Resolution (Priority: P4)

For video formats, the user can choose from the resolutions actually available for the source video (e.g., 2160p, 1440p, 1080p, 720p, 480p, 360p). The highest available is selected by default.

**Why this priority**: Gives control over file size and device compatibility, but the highest-quality default already satisfies most users, so this can ship later.

**Independent Test**: Load a video that offers 1080p and 720p, select 720p, download a clip, and verify the downloaded clip is 720p.

**Acceptance Scenarios**:

1. **Given** a loaded video, **When** the user opens the quality selector, **Then** only the resolutions available for that specific video are listed, with the highest pre-selected.
2. **Given** 720p is selected, **When** the clip is downloaded, **Then** the delivered clip is 720p.
3. **Given** an audio-only format is selected, **When** the user views the controls, **Then** the resolution selector is hidden or disabled because it does not apply.

---

### Edge Cases

- **Zero or negative length**: start equals end, or end precedes start → Download is blocked with an inline explanation.
- **Out-of-range times**: negative start or end beyond the video's duration → clamped to the valid range with a visible notice.
- **Loose timestamp input**: values such as `1:05`, `65`, or `1h5m` → normalised when unambiguous; otherwise an inline validation message shows the accepted formats.
- **URL variants**: `youtu.be` short links, Shorts links, mobile (`m.youtube.com`) links, links with extra parameters (e.g., a `t=` start time), and playlist links that also identify a video → all resolve to that single video. A playlist-only link (no video) → message that a single video link is needed.
- **Pre-filled start time**: a URL that carries a start timestamp → the start field is pre-filled with that time.
- **Video becomes unavailable mid-download** → the download stops; pressing Download again shows the specific reason.
- **In-progress live stream** → refused with a message that only completed videos can be clipped.
- **Source missing an audio track, audio format requested** → refused with a clear explanation.
- **Very long clip (hours)** → the download keeps streaming until complete; the application never times it out for being long.
- **Interrupted download** (network drop, browser closed) → the user presses Download again; the clip is produced afresh on demand.
- **Identical request submitted twice** → both requests succeed; the user is not blocked or penalised.
- **Extremely large output** → the user sees the clip's duration and an estimated file size before pressing Download so they can make an informed choice; the request is never refused for size.
- **Service still starting up** → the page says so and enables Download as soon as the service responds.
- **Very short request (e.g., 1–2 seconds)** → the delivered clip may be noticeably longer than requested because boundaries snap outward to natural cut points; the approximate-boundary notice (FR-015) makes this expectation clear.

## Requirements *(mandatory)*

### Functional Requirements

**Input & validation**

- **FR-001**: System MUST accept a YouTube video link in its common forms (standard watch link, `youtu.be` short link, Shorts link, mobile link, and links carrying extra parameters) and identify the single video it refers to.
- **FR-002**: System MUST reject links that are not YouTube video links, or that do not identify a single video, with a plain-language explanation of what is accepted.
- **FR-003**: After accepting a link, System MUST display the video's title, thumbnail, and total duration before the user chooses a range.
- **FR-004**: Users MUST be able to specify start and end times to at least one-second precision by typing timestamps (`HH:MM:SS` or `MM:SS`); when a link carries a start time, the start field MUST be pre-filled with it.
- **FR-005**: System MUST validate that `0 ≤ start < end ≤ video duration` and that the clip is at least one second long, showing violations inline before submission and clamping out-of-range values with a visible notice.
- **FR-006**: System MUST NOT impose any maximum clip duration; a clip MAY span the entire video regardless of its length.
- **FR-007**: System MUST NOT impose quotas on the number of clips created — per day, per video, per device, or otherwise.
- **FR-008**: System MUST NOT require sign-up, sign-in, payment, or any account to use any capability described in this specification.
- **FR-009**: System MUST display the selected range's duration and an estimated file size before the user presses Download.

**Format & quality**

- **FR-010**: System MUST offer the following output formats: MP4 and WebM (video with sound), and MP3, M4A, OGG, and Opus (audio only). MP4 MUST be the default.
- **FR-011**: For video formats, System MUST offer only the resolutions actually available for the chosen source video and MUST default to the highest available. For audio-only formats the resolution choice MUST not be shown.
- **FR-012**: Delivered video clips MUST be at the resolution the user selected — never a lower one — and MUST preserve the source's visual quality at that resolution.
- **FR-013**: Output MUST NOT contain watermarks, overlays, intros, outros, or any added branding.

**Clip boundaries**

- **FR-014**: The delivered clip MUST contain the entire requested range. Boundaries MAY extend outward — the clip may begin a few seconds before the requested start and end a few seconds after the requested end, snapping to the video's nearest natural cut points — but MUST never begin after the requested start or end before the requested end. The source's original quality MUST be preserved rather than traded for exact boundaries.
- **FR-015**: System MUST tell the user, near the time-range controls and before they press Download, that clip boundaries are approximate and may include a few extra seconds at either end.

**Processing & delivery**

- **FR-016**: After the user presses Download, the browser's download MUST begin within a few seconds; the clip is produced while it downloads, and the browser's own download manager shows progress. No separate status page or page refresh is required.
- **FR-017**: The downloaded file's name MUST include the video title and the selected time range, and its extension MUST match the chosen format.
- **FR-018**: Time to produce a clip MUST scale with the clip's length, not with the source video's length — a short clip from a very long video MUST download about as fast as the same-length clip from a short video.
- **FR-019**: When a download cannot be produced, System MUST show a specific, plain-language reason (e.g., video not publicly accessible, video no longer available, no audio track, processing error, service busy); the user can simply press Download again.
- **FR-020**: System MUST NOT store video content, clips, or request records anywhere on the server; every download is produced on demand and discarded as it is delivered.
- **FR-021**: Once a download starts, the page MUST tell the user to keep the browser open until it finishes.
- **FR-022**: System MUST process only publicly accessible, completed videos. Private, members-only, sign-in-required (age-restricted), DRM-protected, and in-progress live-stream videos MUST be refused with a plain-language message.
- **FR-023**: Users MUST be able to download multiple clips from the same video by choosing new ranges; each download is independent.
- **FR-024**: The experience MUST work in current mainstream browsers on desktop and mobile devices without installing any software.

### Key Entities *(include if feature involves data)*

- **Source Video**: The public YouTube video the user wants to cut. Key attributes: video identifier, title, thumbnail, total duration, available resolutions (each with an indicative data rate for the size estimate), availability state (public / not accessible / live / removed). Looked up on demand; never stored.
- **Clip Request**: The user's choices for one download: the Source Video, start time, end time, output format, chosen resolution (video formats only). Exists only for the duration of that download; many Clip Requests may reference the same Source Video.
- **Clip File**: The download itself — the deliverable produced from a Clip Request as it is transferred. Key attributes: format, resolution (video only), actual duration (may slightly exceed the request), file name. Never kept on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can go from landing on the page to holding a downloaded 30-second clip in under 2 minutes, using only what is shown on the page.
- **SC-002**: 95% of clips of 60 seconds or less are fully downloaded within 30 seconds of pressing Download (service already running, typical broadband connection).
- **SC-003**: Producing a 30-second clip from a 3-hour video takes no more than 25% longer than producing a 30-second clip from a 5-minute video.
- **SC-004**: A clip created at the default (highest) quality from a 4K source is delivered at 4K; no clip is ever delivered below the resolution the user selected.
- **SC-005**: 100% of delivered clips are free of watermarks and added content.
- **SC-006**: A clip spanning an entire 4-hour video is accepted and streams to completion without being cut off by the application.
- **SC-007**: Zero requests are refused because of quotas, account status, or payment.
- **SC-008**: 100% of failed requests show a specific reason the user can act on (not a generic "something went wrong").
- **SC-009**: Files in all six offered formats play in common media players and on common devices without conversion.
- **SC-010**: When the service is already running, the download begins within 5 seconds of pressing Download.
- **SC-011**: In usability testing, at least 90% of first-time users complete their first clip without assistance.
- **SC-012**: 100% of delivered clips contain the entire requested range, with no more than 10 seconds of extra content at either boundary.

## Assumptions

- **Delivery form**: This is a browser-based web application mirroring the reference tool; a command-line or desktop application is out of scope.
- **Source platform**: YouTube only. Other video platforms are out of scope.
- **Audience & abuse protection**: A single person (the operator) using the tool personally. Because the user has explicitly asked for no limits, rate limiting, CAPTCHAs, and quotas are intentionally excluded. Exposing it publicly without such measures is an acknowledged risk that is out of scope for this feature.
- **No server storage (user decision)**: Nothing — video content, clips, or requests — is stored on the server; the clip is produced while it downloads and discarded as it is delivered. Consequently the browser must stay open until the download completes, and "leave and come back", clip history, shareable clip links and 24-hour hosting of clips are explicitly out of scope.
- **Hosting budget**: The service runs on free-tier hosting with a small monthly data-transfer allowance and a short start-up delay when idle; a single very large clip can exhaust the allowance. The application still imposes no limit; the size estimate lets the user decide.
- **Precision & minimum**: Timestamps are handled to one-second precision; sub-second selection is not required. The minimum clip length is one second (the "no limits" direction concerns the maximum only).
- **Cut precision (user decision)**: Clip boundaries snap outward to the video's nearest natural cut points rather than landing exactly on the requested timestamps. This was chosen deliberately to keep processing fast and preserve original quality, mirroring the reference tool; exact-boundary cutting is out of scope.
- **Audio & captions**: When a video has more than one audio track, the default track is used. Subtitles and captions are not included in clips.
- **Quality ceiling**: Any upper bound on resolution (e.g., "up to 4K") is inherited from what the source offers; the system itself imposes none.
- **Explicitly excluded from the reference tool**: accounts and sign-in; pricing, plans, and a "Pro" tier; per-day clip quotas; tiered ("faster") processing; hosting of finished clips (24-hour links) and clip history; the developer API; the public clip gallery ("Clips" page); promotional content. Legal notices (terms, privacy, disclaimer) are static content outside this specification.
- **Responsibility**: Users are responsible for complying with YouTube's terms and applicable copyright law when using the tool.
