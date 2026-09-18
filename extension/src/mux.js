// Cutting and muxing with ffmpeg.wasm (single-threaded core, in-memory files). Video is always
// stream-copied; audio is copied when the container can carry it and transcoded otherwise.
import { FFmpeg } from "../vendor/ffmpeg/index.js";
import { OUTPUTS } from "./formats.js";

const END_PADDING_S = 1; // read one extra second so the requested end is always inside the clip

export class Muxer {
  constructor() {
    this.ffmpeg = null;
    this.logs = [];
  }

  async load() {
    if (this.ffmpeg) return;
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      this.logs.push(message);
      if (this.logs.length > 200) this.logs.shift();
    });
    await ffmpeg.load({
      coreURL: chrome.runtime.getURL("vendor/ffmpeg-core/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/ffmpeg-core/ffmpeg-core.wasm"),
      classWorkerURL: chrome.runtime.getURL("vendor/ffmpeg/worker.js"),
    });
    this.ffmpeg = ffmpeg;
  }

  /**
   * `video`/`audio` are `{ bytes, t0, format }` (t0 = time of their first segment) or null.
   * Returns `{ bytes, mime, ext }`.
   */
  async cut({ video, audio, outputKey, startS, endS, onProgress }) {
    await this.load();
    const output = OUTPUTS[outputKey];
    const outName = `clip.${output.ext}`;
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
    const audioIn = `a.${audio.format.container === "mp4" ? "m4a" : "webm"}`;

    if (video) {
      // The video starts at its keyframe t0; the audio is seeked to that same instant.
      const videoIn = `v.${video.format.container}`;
      await this.ffmpeg.writeFile(videoIn, video.bytes);
      await this.ffmpeg.writeFile(audioIn, audio.bytes);
      args.push("-i", videoIn, "-ss", seconds(Math.max(0, video.t0 - audio.t0)), "-i", audioIn);
      args.push("-map", "0:v:0", "-map", "1:a:0", "-t", seconds(endS + END_PADDING_S - video.t0));
      args.push("-c:v", "copy", ...audioArgs(outputKey, audio.format));
    } else {
      await this.ffmpeg.writeFile(audioIn, audio.bytes);
      args.push("-ss", seconds(Math.max(0, startS - audio.t0)), "-i", audioIn, "-vn", "-t", seconds(endS - startS));
      args.push(...audioArgs(outputKey, audio.format));
    }
    args.push(...containerArgs(outputKey), "-avoid_negative_ts", "make_zero", "-y", outName);

    this.logs = [];
    const onFfmpegProgress = ({ progress }) => onProgress?.(Math.min(1, Math.max(0, progress)));
    this.ffmpeg.on("progress", onFfmpegProgress);
    let code;
    try {
      code = await this.ffmpeg.exec(args);
    } finally {
      this.ffmpeg.off("progress", onFfmpegProgress);
    }
    if (code !== 0) {
      await this.cleanup([video && `v.${video.format.container}`, audioIn, outName]);
      throw new Error(`ffmpeg failed (exit ${code}): ${this.logs.slice(-3).join(" | ") || "no details"}`);
    }
    const bytes = await this.ffmpeg.readFile(outName);
    await this.cleanup([video && `v.${video.format.container}`, audioIn, outName]);
    return { bytes, mime: output.mime, ext: output.ext };
  }

  async cleanup(names) {
    for (const name of names.filter(Boolean)) {
      await this.ffmpeg.deleteFile(name).catch(() => {});
    }
  }
}

function seconds(value) {
  return value.toFixed(3);
}

/** Copy when the output container carries the source codec, otherwise encode. */
function audioArgs(outputKey, sourceFormat) {
  const codec = sourceFormat.acodec;
  switch (outputKey) {
    case "mp4":
    case "m4a":
      return codec === "mp4a" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"];
    case "webm":
    case "opus":
      return codec === "opus" ? ["-c:a", "copy"] : ["-c:a", "libopus", "-b:a", "128k"];
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", "192k"];
    case "ogg":
      return codec === "vorbis" ? ["-c:a", "copy"] : ["-c:a", "libvorbis", "-q:a", "5"];
    default:
      throw new Error(`Unknown output ${outputKey}`);
  }
}

function containerArgs(outputKey) {
  switch (outputKey) {
    case "mp4":
    case "m4a":
      return ["-movflags", "+faststart", "-f", outputKey === "mp4" ? "mp4" : "ipod"];
    case "webm":
      return ["-f", "webm"];
    case "opus":
      return ["-f", "opus"];
    case "ogg":
      return ["-f", "ogg"];
    case "mp3":
      return ["-f", "mp3"];
    default:
      return [];
  }
}
