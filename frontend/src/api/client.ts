/** Typed client for the three API endpoints (see specs/001-youtube-clip-download/contracts/openapi.yaml). */

export type OutputFormat = "mp4" | "webm" | "mp3" | "m4a" | "ogg" | "opus";
export type VideoCodec = "avc1" | "vp9" | "av01";

export interface VideoVariant {
  height: number;
  fps: number;
  vcodec: VideoCodec;
  video_kbps: number;
}

export interface VideoInfo {
  video_id: string;
  canonical_url: string;
  title: string;
  channel: string;
  thumbnail_url: string;
  duration_s: number;
  embeddable: boolean;
  has_audio: boolean;
  resolutions: { mp4: VideoVariant[]; webm: VideoVariant[] };
  audio: { m4a_kbps: number | null; opus_kbps: number | null };
  start_hint_s: number | null;
}

export interface Health {
  status: "ok" | "degraded";
  yt_dlp_version: string;
  ffmpeg: { available: boolean; version: string | null };
  js_runtime: { name: string | null; available: boolean };
  streams: { active: number; max: number };
  rss_mb: number | null;
}

export interface ClipRequest {
  v: string;
  start: number;
  end: number;
  format: OutputFormat;
  height?: number | null;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

interface ErrorPayload {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const payload = (body ?? {}) as ErrorPayload;
      throw new ApiError(
        payload.code ?? "http_error",
        payload.message ?? `The server answered with status ${response.status}.`,
        response.status,
        payload.details,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted && !signal?.aborted) {
      throw new ApiError("timeout", "The server took too long to respond.", 0);
    }
    if (signal?.aborted) throw error;
    throw new ApiError("network", "Could not reach the server.", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Cheap wake-up probe; a cold free-tier instance can take ~60 s to answer. */
export function health(signal?: AbortSignal): Promise<Health> {
  return request<Health>("/api/health", { method: "GET" }, 90_000, signal);
}

export function resolve(url: string, signal?: AbortSignal): Promise<VideoInfo> {
  return request<VideoInfo>(
    "/api/videos/resolve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
    120_000,
    signal,
  );
}

/** URL the Download anchor points at; the response is the clip itself. */
export function clipUrl(params: ClipRequest): string {
  const query = new URLSearchParams({
    v: params.v,
    start: String(params.start),
    end: String(params.end),
    format: params.format,
  });
  if (params.height != null) query.set("height", String(params.height));
  return apiUrl(`/api/clip?${query.toString()}`);
}
