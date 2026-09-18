import type { OutputFormat, VideoInfo, VideoVariant } from "../api/client";

/** Fixed target for the two formats the server has to transcode (research R8). */
export const TRANSCODED_AUDIO_KBPS = 190;
/** Container/muxing overhead applied to the raw stream estimate. */
export const OVERHEAD_FACTOR = 1.03;

export const DEFAULT_LARGE_DOWNLOAD_BYTES = 500 * 1024 * 1024;

export function largeDownloadThreshold(): number {
  const raw = import.meta.env.VITE_LARGE_DOWNLOAD_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LARGE_DOWNLOAD_BYTES;
}

export function estimateBytes(input: {
  durationS: number;
  videoKbps: number;
  audioKbps: number;
}): number {
  const kbps = Math.max(0, input.videoKbps) + Math.max(0, input.audioKbps);
  return Math.round((Math.max(0, input.durationS) * kbps * 1000 * OVERHEAD_FACTOR) / 8);
}

export function audioKbpsFor(format: OutputFormat, audio: VideoInfo["audio"]): number {
  switch (format) {
    case "mp4":
    case "m4a":
      return audio.m4a_kbps ?? audio.opus_kbps ?? 0;
    case "webm":
    case "opus":
      return audio.opus_kbps ?? audio.m4a_kbps ?? 0;
    case "mp3":
    case "ogg":
      return TRANSCODED_AUDIO_KBPS;
  }
}

export function variantFor(
  video: VideoInfo,
  format: OutputFormat,
  height: number | null,
): VideoVariant | null {
  if (format !== "mp4" && format !== "webm") return null;
  return video.resolutions[format].find((v) => v.height === height) ?? null;
}

export function estimateForSelection(input: {
  video: VideoInfo;
  format: OutputFormat;
  height: number | null;
  startS: number;
  endS: number;
}): number {
  const variant = variantFor(input.video, input.format, input.height);
  return estimateBytes({
    durationS: input.endS - input.startS,
    videoKbps: variant?.video_kbps ?? 0,
    audioKbps: audioKbpsFor(input.format, input.video.audio),
  });
}
