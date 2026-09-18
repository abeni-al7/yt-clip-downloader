/** All user-facing strings (specs/001-youtube-clip-download/contracts/ui-contract.md → Copy deck). */
export const copy = {
  server_waking:
    "Starting the server… free hosting sleeps when idle, so this can take up to a minute.",
  server_down: "The server isn't responding right now.",
  boundary_notice:
    "Clips are cut at the nearest natural point, so your file may include a few extra seconds at the start or end.",
  end_before_start: "End must be after start.",
  end_clamped: (duration: string) => `End adjusted to the video's length (${duration}).`,
  start_clamped: "Start adjusted to the beginning of the video.",
  bad_timestamp: "Use HH:MM:SS, MM:SS, or seconds (e.g. 1:05, 65, 1h5m).",
  not_youtube: "Please paste a link to a YouTube video (youtube.com or youtu.be).",
  playlist_only: "That link points to a playlist. Paste a link to a single video.",
  no_audio: "This video has no audio track to extract.",
  no_webm: "This video has no WebM-compatible (VP9/AV1) stream.",
  mp4_hi_res_note: "Above 1080p, MP4 uses the VP9/AV1 codec; very old players may not support it.",
  audio_convert_note: "Converted on the server — slower for long clips.",
  size_estimate: (size: string) => `≈ ${size}`,
  large_download_note:
    "Large download. This tool runs on a free server with a small monthly bandwidth allowance — a lower resolution or shorter range keeps it free.",
  download_hint:
    "Your download should start in a new tab within a few seconds. Keep your browser open until it finishes — the clip is cut while it downloads.",
  download_failed_hint:
    "If the download didn't start, the new tab shows why. You can simply try again.",
  try_again_suffix: "Try again in a moment.",
  busy: "The server is busy with another clip — this page will retry automatically.",
} as const;
