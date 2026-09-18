/** Client mirror of backend/src/ytclip/domain/youtube_url.py — instant feedback only; the server
 * re-validates. */

import { parseTimestamp } from "./timestamps";

export type ParsedYoutubeUrl =
  | { ok: true; videoId: string; startHintS: number | null }
  | { ok: false; error: "not_youtube" | "playlist_only" };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const ID_PATH_PREFIXES = new Set(["shorts", "live", "embed", "v"]);

export function parseYoutubeUrl(input: string): ParsedYoutubeUrl {
  let text = input.trim();
  if (!text) return { ok: false, error: "not_youtube" };
  if (VIDEO_ID.test(text)) return { ok: true, videoId: text, startHintS: null };
  if (!text.includes("://")) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "not_youtube" };
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { ok: false, error: "not_youtube" };

  const segments = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (SHORT_HOSTS.has(host)) {
    videoId = segments[0] ?? null;
  } else if (segments[0] === "watch") {
    videoId = url.searchParams.get("v") ?? (segments.length === 2 ? segments[1]! : null);
  } else if (segments.length >= 2 && ID_PATH_PREFIXES.has(segments[0]!)) {
    videoId = segments[1]!;
  }

  if (videoId === null) {
    return { ok: false, error: url.searchParams.has("list") ? "playlist_only" : "not_youtube" };
  }
  if (!VIDEO_ID.test(videoId)) return { ok: false, error: "not_youtube" };
  return { ok: true, videoId, startHintS: startHint(url) };
}

function startHint(url: URL): number | null {
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const source of [url.searchParams, fragment]) {
    for (const key of ["t", "start"]) {
      const raw = source.get(key);
      if (raw !== null) {
        const parsed = parseTimestamp(raw);
        if (parsed !== null) return parsed;
      }
    }
  }
  return null;
}
