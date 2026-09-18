// The end-to-end clip job: pick formats → read indexes → fetch only the needed segments → mux.
import { concat, fetchRange } from "./fetcher.js";
import { OUTPUTS, estimateBytes, pickAudio, pickVideo } from "./formats.js";
import { chooseSegments, parseIndex } from "./segments.js";

const END_PADDING_S = 1;

export class ClipError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Validate the request against the resolved video and choose the source formats. */
export function planClip(video, { outputKey, height, startS, endS }) {
  const output = OUTPUTS[outputKey];
  if (!output) throw new ClipError("invalid_format", "Choose an output format.");
  if (!Number.isInteger(startS) || !Number.isInteger(endS) || startS < 0) throw new ClipError("invalid_range", "Start and end must be timestamps.");
  if (endS <= startS) throw new ClipError("invalid_range", "The end must be after the start.");
  if (startS >= video.durationS) throw new ClipError("invalid_range", `The video is only ${video.durationS} seconds long.`);
  const clampedEnd = Math.min(endS, video.durationS);

  let videoFormat = null;
  if (output.isVideo) {
    if (!height) throw new ClipError("unsupported_resolution", "Choose a resolution.");
    videoFormat = pickVideo(video.formats, output.container, height);
    if (!videoFormat) throw new ClipError("unsupported_resolution", `${height}p is not available as ${output.label}.`);
  }
  const audioFormat = pickAudio(video.formats, outputKey);
  if (!audioFormat) throw new ClipError("no_audio_track", "This video has no audio track.");
  return {
    output,
    outputKey,
    videoFormat,
    audioFormat,
    startS,
    endS: clampedEnd,
    estimatedBytes: estimateBytes(videoFormat, audioFormat, clampedEnd - startS + (videoFormat ? 5 : 0)),
  };
}

async function readIndex(format, signal) {
  const [init, index] = await Promise.all([
    fetchRange(format.url, format.initRange.start, format.initRange.end, { signal }),
    fetchRange(format.url, format.indexRange.start, format.indexRange.end, { signal }),
  ]);
  return { init, segments: parseIndex(format, init, index) };
}

/** Fetch init + the segments overlapping [from, to); returns `{ bytes, t0, format }`. */
async function fetchTrack(format, from, to, { signal, onBytes, onPlanned }) {
  const { init, segments } = await readIndex(format, signal);
  const chosen = chooseSegments(segments, from, to);
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  onPlanned?.(last.end - first.start + 1);
  const media = await fetchRange(format.url, first.start, last.end, { signal, onBytes });
  return { bytes: concat([init, media]), t0: first.t0, format };
}

/**
 * Run a planned clip. `report({ phase, loaded, total })` receives progress; `muxer` is a loaded Muxer.
 */
export async function runClip(plan, muxer, { signal, report = () => {} } = {}) {
  const to = plan.endS + END_PADDING_S;
  let total = 0;
  let loaded = 0;
  const onPlanned = (bytes) => {
    total += bytes;
    report({ phase: "fetch", loaded, total });
  };
  const onBytes = (n) => {
    loaded += n;
    report({ phase: "fetch", loaded, total });
  };

  let video = null;
  if (plan.videoFormat) {
    video = await fetchTrack(plan.videoFormat, plan.startS, to, { signal, onBytes, onPlanned });
  }
  // Audio starts where the video does (its keyframe), so the lead-in has sound too.
  const audioFrom = video ? video.t0 : plan.startS;
  const audio = await fetchTrack(plan.audioFormat, audioFrom, to, { signal, onBytes, onPlanned });

  report({ phase: "mux", loaded: 0, total: 1 });
  const result = await muxer.cut({
    video,
    audio,
    outputKey: plan.outputKey,
    startS: plan.startS,
    endS: plan.endS,
    onProgress: (ratio) => report({ phase: "mux", loaded: ratio, total: 1 }),
  });
  return { ...result, clipStartS: video ? video.t0 : plan.startS };
}
