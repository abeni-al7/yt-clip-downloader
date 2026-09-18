// YouTube link recognition, mirroring the backend's domain/youtube_url.py.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);
const PATH_PREFIXES = ["/shorts/", "/live/", "/embed/", "/v/"];

/** `90`, `90s`, `1m30s`, `1h2m3s`, `1:30`, `1:02:03` → seconds (or null). */
export function parseStartHint(text) {
  if (!text) return null;
  const value = String(text).trim().toLowerCase();
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10);
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0);
  }
  if (/^\d+(:\d+){1,2}$/.test(value)) {
    return value.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
  }
  return null;
}

/** Returns `{ videoId, startHintS }`, or null when the text is not a single YouTube video link. */
export function parseYoutubeUrl(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (VIDEO_ID.test(trimmed)) return { videoId: trimmed, startHintS: null };

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  let videoId = null;
  const host = url.hostname.toLowerCase();
  if (host.endsWith("youtu.be")) {
    videoId = url.pathname.split("/")[1] || null;
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v");
  } else {
    const prefix = PATH_PREFIXES.find((p) => url.pathname.startsWith(p));
    if (prefix) videoId = url.pathname.slice(prefix.length).split("/")[0] || null;
  }
  if (!videoId || !VIDEO_ID.test(videoId)) return null;

  const fragmentTime = url.hash.startsWith("#t=") ? url.hash.slice(3) : null;
  const startHintS = parseStartHint(url.searchParams.get("t") || url.searchParams.get("start") || fragmentTime);
  return { videoId, startHintS };
}

export function canonicalUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
