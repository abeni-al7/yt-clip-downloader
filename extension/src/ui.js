// Page controller: load a video, choose a range/format/quality, cut, and hand the file to Chrome.
import { ChallengeSolver } from "./challenges.js";
import { ClipError, planClip, runClip } from "./clip.js";
import { downloadFilename } from "./filenames.js";
import { OUTPUTS, humanBytes, resolutions } from "./formats.js";
import { Muxer } from "./mux.js";
import { installNetRules } from "./netrules.js";
import { formatHms, parseTimestamp } from "./timestamps.js";
import { ResolveError, resolveVideo } from "./youtube.js";
import { canonicalUrl, parseYoutubeUrl } from "./youtube_url.js";

const WARN_BYTES = 500 * 1024 * 1024;
const MAX_BYTES = 1536 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const el = {
  resolveForm: $("resolve-form"),
  url: $("url"),
  load: $("load"),
  resolveStatus: $("resolve-status"),
  resolveError: $("resolve-error"),
  video: $("video"),
  thumb: $("thumb"),
  title: $("title"),
  byline: $("byline"),
  clipForm: $("clip-form"),
  start: $("start"),
  end: $("end"),
  format: $("format"),
  qualityField: $("quality-field"),
  quality: $("quality"),
  estimate: $("estimate"),
  download: $("download"),
  cancel: $("cancel"),
  progress: $("progress"),
  barFill: $("bar-fill"),
  progressText: $("progress-text"),
  clipError: $("clip-error"),
  done: $("done"),
};

const solver = new ChallengeSolver();
let muxer = new Muxer();
let video = null;
let abort = null;

function show(node, visible = true) {
  node.classList.toggle("hidden", !visible);
}

function setError(node, message) {
  node.textContent = message || "";
  show(node, Boolean(message));
}

function describeError(error) {
  if (error instanceof ResolveError || error instanceof ClipError) return error.message;
  if (error?.name === "AbortError") return "Cancelled.";
  return `Something went wrong: ${error?.message || error}`;
}

// --- resolve --------------------------------------------------------------------------------

async function resolve(text) {
  const parsed = parseYoutubeUrl(text);
  setError(el.resolveError, null);
  if (!parsed) {
    setError(el.resolveError, "That is not a link to a single YouTube video.");
    return;
  }
  el.url.value = canonicalUrl(parsed.videoId);
  el.load.disabled = true;
  show(el.video, false);
  try {
    video = await resolveVideo(parsed.videoId, solver, (status) => {
      el.resolveStatus.textContent = status;
    });
    el.resolveStatus.textContent = "";
    showVideo(parsed.startHintS);
    muxer.load().catch(() => {}); // warm up ffmpeg while the user picks a range
  } catch (error) {
    el.resolveStatus.textContent = "";
    setError(el.resolveError, describeError(error));
  } finally {
    el.load.disabled = false;
  }
}

function showVideo(startHintS) {
  el.thumb.src = video.thumbnail;
  el.title.textContent = video.title;
  el.byline.textContent = `${video.author ? `${video.author} · ` : ""}${formatHms(video.durationS)}`;
  el.format.replaceChildren(
    ...Object.entries(OUTPUTS).map(([key, output]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = output.label;
      return option;
    }),
  );
  el.format.value = "mp4";
  const start = Math.min(startHintS ?? 0, Math.max(0, video.durationS - 1));
  el.start.value = formatHms(start);
  el.end.value = formatHms(Math.min(video.durationS, start + 30));
  fillQualities();
  setError(el.clipError, null);
  show(el.done, false);
  show(el.progress, false);
  show(el.video, true);
  el.start.focus();
}

function fillQualities() {
  const output = OUTPUTS[el.format.value];
  show(el.qualityField, output.isVideo);
  if (!output.isVideo) {
    updateEstimate();
    return;
  }
  const previous = Number(el.quality.value) || 720;
  const options = resolutions(video.formats, output.container);
  el.quality.replaceChildren(
    ...options.map((r) => {
      const option = document.createElement("option");
      option.value = String(r.height);
      option.textContent = `${r.height}p${r.fps > 30 ? r.fps : ""} · ${r.vcodec} · ${r.kbps} kbps`;
      return option;
    }),
  );
  const heights = options.map((r) => r.height);
  el.quality.value = String(heights.includes(previous) ? previous : heights.includes(720) ? 720 : heights[0]);
  el.download.disabled = !options.length;
  if (!options.length) el.estimate.textContent = `No ${output.label} streams for this video.`;
  else updateEstimate();
}

function currentRequest() {
  return {
    outputKey: el.format.value,
    height: OUTPUTS[el.format.value].isVideo ? Number(el.quality.value) : null,
    startS: parseTimestamp(el.start.value),
    endS: parseTimestamp(el.end.value),
  };
}

function updateEstimate() {
  if (!video) return;
  try {
    const plan = planClip(video, currentRequest());
    const tracks = [plan.videoFormat && `${plan.videoFormat.height}p ${plan.videoFormat.vcodec}`, `${plan.audioFormat.acodec} audio`].filter(Boolean).join(" + ");
    const warning = plan.estimatedBytes > MAX_BYTES ? " — too large to assemble in memory; pick a lower quality or a shorter range" : plan.estimatedBytes > WARN_BYTES ? " — large; this can take a while" : "";
    el.estimate.textContent = `About ${humanBytes(plan.estimatedBytes)} · ${formatHms(plan.endS - plan.startS)} · ${tracks}${warning}`;
    el.download.disabled = plan.estimatedBytes > MAX_BYTES;
  } catch (error) {
    el.estimate.textContent = describeError(error);
    el.download.disabled = true;
  }
}

// --- download -------------------------------------------------------------------------------

function reportProgress({ phase, loaded, total }) {
  const ratio = total ? Math.min(1, loaded / total) : 0;
  el.barFill.style.width = `${Math.round(ratio * 100)}%`;
  el.progressText.textContent =
    phase === "fetch" ? `Fetching ${humanBytes(loaded)}${total ? ` of ${humanBytes(total)}` : ""}…` : `Cutting the clip… ${Math.round(ratio * 100)}%`;
}

function saveFile(bytes, mime, filename) {
  const blob = new Blob([bytes], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

async function download() {
  setError(el.clipError, null);
  show(el.done, false);
  let plan;
  try {
    plan = planClip(video, currentRequest());
  } catch (error) {
    setError(el.clipError, describeError(error));
    return;
  }
  abort = new AbortController();
  el.download.disabled = true;
  el.load.disabled = true;
  show(el.cancel, true);
  show(el.progress, true);
  reportProgress({ phase: "fetch", loaded: 0, total: 0 });
  try {
    const result = await runClip(plan, muxer, { signal: abort.signal, report: reportProgress });
    const filename = downloadFilename(video.title, plan.startS, plan.endS, result.ext);
    saveFile(result.bytes, result.mime, filename);
    const snapped = result.clipStartS < plan.startS - 0.5 ? ` The clip starts at ${formatHms(Math.floor(result.clipStartS))}, the nearest keyframe before your start.` : "";
    el.done.textContent = `Saved “${filename}” (${humanBytes(result.bytes.length)}).${snapped}`;
    show(el.done, true);
  } catch (error) {
    if (abort.signal.aborted && !(error instanceof ClipError)) {
      setError(el.clipError, "Cancelled.");
    } else {
      setError(el.clipError, describeError(error));
    }
  } finally {
    show(el.progress, false);
    show(el.cancel, false);
    el.download.disabled = false;
    el.load.disabled = false;
    abort = null;
  }
}

function cancel() {
  if (!abort) return;
  abort.abort();
  // ffmpeg.wasm cannot interrupt a running command; drop the worker and start a fresh one.
  if (muxer.ffmpeg) {
    muxer.ffmpeg.terminate();
    muxer = new Muxer();
  }
}

// --- wiring ---------------------------------------------------------------------------------

el.resolveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  resolve(el.url.value);
});
el.url.addEventListener("paste", () => {
  setTimeout(() => {
    if (parseYoutubeUrl(el.url.value)) resolve(el.url.value);
  }, 0);
});
el.clipForm.addEventListener("submit", (event) => {
  event.preventDefault();
  download();
});
el.cancel.addEventListener("click", cancel);
el.format.addEventListener("change", fillQualities);
for (const input of [el.start, el.end, el.quality]) input.addEventListener("input", updateEstimate);
el.quality.addEventListener("change", updateEstimate);

(async () => {
  try {
    await installNetRules();
  } catch (error) {
    setError(el.resolveError, `The extension could not set up its network rules: ${error.message}`);
    return;
  }
  const params = new URLSearchParams(location.search);
  const videoId = params.get("v");
  if (videoId) {
    const hint = params.get("t");
    const url = canonicalUrl(videoId) + (hint ? `&t=${encodeURIComponent(hint)}` : "");
    el.url.value = url;
    resolve(url);
  } else {
    el.url.focus();
  }
})();
