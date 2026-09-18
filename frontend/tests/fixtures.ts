import type { Health, VideoInfo } from "../src/api/client";

export const VIDEO: VideoInfo = {
  video_id: "dQw4w9WgXcQ",
  canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channel: "Rick Astley",
  thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  duration_s: 212,
  embeddable: true,
  has_audio: true,
  resolutions: {
    mp4: [
      { height: 1080, fps: 30, vcodec: "avc1", video_kbps: 4000 },
      { height: 720, fps: 30, vcodec: "avc1", video_kbps: 2500 },
      { height: 360, fps: 30, vcodec: "avc1", video_kbps: 700 },
    ],
    webm: [{ height: 720, fps: 30, vcodec: "vp9", video_kbps: 1500 }],
  },
  audio: { m4a_kbps: 128, opus_kbps: 140 },
  start_hint_s: 60,
};

export const HEALTH: Health = {
  status: "ok",
  yt_dlp_version: "2026.08.19",
  ffmpeg: { available: true, version: "7.1" },
  js_runtime: { name: "deno", available: true },
  pot_provider: { url: "http://127.0.0.1:4416", available: true, version: "2.0.0" },
  player_clients: ["mweb", "visionos"],
  streams: { active: 0, max: 2 },
  rss_mb: 120,
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Installs a fetch mock that routes by path; returns the list of requests made. */
export function mockApi(handlers: { health?: Handler; resolve?: Handler }): {
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes("/api/health")) {
      return (handlers.health ?? (() => jsonResponse(HEALTH)))(url, init);
    }
    if (url.includes("/api/videos/resolve")) {
      return (handlers.resolve ?? (() => jsonResponse(VIDEO)))(url, init);
    }
    return new Response("not found", { status: 404 });
  };
  globalThis.fetch = fetchMock as typeof fetch;
  return { calls };
}

export function neverResolves(): Promise<Response> {
  return new Promise<Response>(() => {});
}
