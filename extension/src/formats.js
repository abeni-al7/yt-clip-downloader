// Output formats, format selection and size estimates. Mirrors backend/src/ytclip/domain/estimate.py:
// the video track is never re-encoded, so the source container must match the output container.

export const OUTPUTS = {
  mp4: { label: "MP4 (video)", isVideo: true, container: "mp4", audioCodec: "mp4a", ext: "mp4", mime: "video/mp4" },
  webm: { label: "WebM (video)", isVideo: true, container: "webm", audioCodec: "opus", ext: "webm", mime: "video/webm" },
  mp3: { label: "MP3 (audio)", isVideo: false, container: null, audioCodec: null, ext: "mp3", mime: "audio/mpeg" },
  m4a: { label: "M4A (audio)", isVideo: false, container: null, audioCodec: "mp4a", ext: "m4a", mime: "audio/mp4" },
  ogg: { label: "OGG (audio)", isVideo: false, container: null, audioCodec: null, ext: "ogg", mime: "audio/ogg" },
  opus: { label: "Opus (audio)", isVideo: false, container: null, audioCodec: "opus", ext: "opus", mime: "audio/ogg" },
};

// Preferred video codec per container; YouTube ships avc1/av01 in mp4 and vp9 in webm.
const VIDEO_PREFERENCE = { mp4: ["avc1", "av01"], webm: ["vp9", "av01"] };

export function normalizeVcodec(codecs) {
  const lowered = String(codecs || "").toLowerCase();
  if (lowered.startsWith("avc1") || lowered.startsWith("h264")) return "avc1";
  if (lowered.startsWith("vp9") || lowered.startsWith("vp09")) return "vp9";
  if (lowered.startsWith("av01")) return "av01";
  return null;
}

export function normalizeAcodec(codecs) {
  const lowered = String(codecs || "").toLowerCase();
  if (lowered.startsWith("mp4a") || lowered.startsWith("aac")) return "mp4a";
  if (lowered.startsWith("opus")) return "opus";
  if (lowered.startsWith("vorbis")) return "vorbis";
  return null;
}

/** `video/mp4; codecs="avc1.64002a"` → `{ kind, container, codecs }`. */
export function parseMimeType(mimeType) {
  const [type, ...params] = String(mimeType || "").split(";");
  const [kind, subtype] = type.trim().split("/");
  const codecsParam = params.map((p) => p.trim()).find((p) => p.startsWith("codecs="));
  const codecs = codecsParam ? codecsParam.slice("codecs=".length).replace(/^"|"$/g, "") : "";
  return { kind, container: subtype === "mp4" ? "mp4" : subtype === "webm" ? "webm" : subtype, codecs };
}

function videoCandidates(formats, container) {
  const preference = VIDEO_PREFERENCE[container] || [];
  return formats.filter((f) => f.vcodec && f.height && f.container === container && preference.includes(f.vcodec));
}

function best(candidates, preference) {
  return candidates.reduce((winner, f) => {
    if (!winner) return f;
    const rank = preference.indexOf(f.vcodec) - preference.indexOf(winner.vcodec);
    if (rank !== 0) return rank < 0 ? f : winner;
    if (f.bitrate !== winner.bitrate) return f.bitrate > winner.bitrate ? f : winner;
    return (f.fps || 0) > (winner.fps || 0) ? f : winner;
  }, null);
}

/** Heights offered for a container, best variant per height, highest first. */
export function resolutions(formats, container) {
  const preference = VIDEO_PREFERENCE[container] || [];
  const byHeight = new Map();
  for (const f of videoCandidates(formats, container)) {
    byHeight.set(f.height, best([byHeight.get(f.height), f].filter(Boolean), preference));
  }
  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map((f) => ({ height: f.height, fps: f.fps || 0, kbps: Math.round(f.bitrate / 1000), vcodec: f.vcodec }));
}

/** The exact height requested — never a lower fallback. */
export function pickVideo(formats, container, height) {
  const preference = VIDEO_PREFERENCE[container] || [];
  return best(videoCandidates(formats, container).filter((f) => f.height === height), preference);
}

/** Audio for an output: its natural codec when available (stream copy), otherwise the best other one (transcode). */
export function pickAudio(formats, outputKey) {
  const output = OUTPUTS[outputKey];
  const audio = formats.filter((f) => f.acodec && !f.vcodec);
  const natural = audio.filter((f) => output.audioCodec && f.acodec === output.audioCodec);
  const pool = natural.length ? natural : audio;
  return pool.reduce((winner, f) => (!winner || f.bitrate > winner.bitrate ? f : winner), null);
}

export function estimateBytes(video, audio, seconds) {
  const bps = (video?.bitrate || 0) + (audio?.bitrate || 0);
  return Math.round((bps / 8) * seconds);
}

export function humanBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
