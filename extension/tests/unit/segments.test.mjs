// Index parsing against real files produced by ffmpeg in YouTube's layout
// (init | index | media segments). Skipped when ffmpeg/ffprobe are not installed.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chooseSegments, parseCues, parseIndex, parseSidx, walkEbml } from "../../src/segments.js";

const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const dir = haveFfmpeg ? mkdtempSync(join(tmpdir(), "ytclip-seg-")) : null;

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

function probeVideoSeconds(path, fps) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return Number(out.trim()) / fps;
}

function boxes(bytes) {
  const found = [];
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    const size = (bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3]) >>> 0;
    found.push({ type: String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)), start: pos, size });
    pos += size;
  }
  return found;
}

test("sidx: segments are contiguous, keyframe-aligned moof boxes covering the whole file", { skip: !haveFfmpeg }, () => {
  const path = join(dir, "v.mp4");
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=duration=12:size=128x72:rate=30",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
    "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof+global_sidx", "-frag_duration", "2000000", path,
  ]);
  const file = new Uint8Array(readFileSync(path));
  const layout = boxes(file);
  const moov = layout.find((b) => b.type === "moov");
  const sidx = layout.find((b) => b.type === "sidx");
  const initRange = { start: 0, end: moov.start + moov.size - 1 };
  const indexRange = { start: sidx.start, end: sidx.start + sidx.size - 1 };

  const segments = parseSidx(file.subarray(indexRange.start, indexRange.end + 1), indexRange.start);
  assert.ok(segments.length >= 6, `expected fragments, got ${segments.length}`);
  assert.equal(segments[0].start, indexRange.end + 1, "first segment follows the index");
  const trailer = layout.at(-1); // ffmpeg appends an mfra box after the last fragment; YouTube's files end with the fragment
  assert.equal(trailer.type, "mfra");
  assert.equal(segments.at(-1).end, trailer.start - 1, "last segment ends where the media ends");
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    assert.equal(String.fromCharCode(...file.subarray(s.start + 4, s.start + 8)), "moof", `segment ${i} starts with a moof box`);
    if (i) {
      assert.equal(s.start, segments[i - 1].end + 1, "contiguous");
      assert.ok(Math.abs(s.t0 - (segments[i - 1].t0 + segments[i - 1].dur)) < 1e-6, "time-contiguous");
    }
  }
  assert.ok(Math.abs(segments.at(-1).t0 + segments.at(-1).dur - 12) < 0.05, "covers 12 s");

  const format = { container: "mp4", indexRange, initRange, contentLength: file.length, approxDurationMs: 12000 };
  assert.deepEqual(parseIndex(format, file.subarray(0, initRange.end + 1), file.subarray(indexRange.start, indexRange.end + 1)), segments);

  // init + the segments overlapping [5, 8) must decode on their own with the right length.
  const chosen = chooseSegments(segments, 5, 8);
  assert.ok(chosen[0].t0 <= 5 && chosen.at(-1).t0 + chosen.at(-1).dur >= 8);
  const clipPath = join(dir, "clip.mp4");
  writeFileSync(clipPath, Buffer.concat([file.subarray(0, initRange.end + 1), file.subarray(chosen[0].start, chosen.at(-1).end + 1)]));
  const expected = chosen.at(-1).t0 + chosen.at(-1).dur - chosen[0].t0;
  assert.ok(Math.abs(probeVideoSeconds(clipPath, 30) - expected) < 0.2, `decoded ${probeVideoSeconds(clipPath, 30)} s ≈ ${expected}`);
});

test("cues: clusters are located from the Segment payload and cover the whole file", { skip: !haveFfmpeg }, () => {
  const path = join(dir, "v.webm");
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=duration=12:size=128x72:rate=30",
    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-g", "30", "-keyint_min", "30",
    "-f", "webm", "-cluster_time_limit", "2000", "-cues_to_front", "1", "-reserve_index_space", "4000", path,
  ]);
  const file = new Uint8Array(readFileSync(path));
  // Locate the Cues element and the first Cluster among the Segment's children.
  let cues = null;
  let firstCluster = null;
  walkEbml(file, 0, file.length, (id, dataStart, dataSize) => {
    if (id !== 0x18538067) return;
    walkEbml(file, dataStart, dataStart + dataSize, (childId, childStart, childSize, elementStart) => {
      if (childId === 0x1c53bb6b) cues = { start: elementStart, end: childStart + childSize - 1 };
      if (childId === 0x1f43b675 && firstCluster == null) firstCluster = elementStart;
    });
  });
  assert.ok(cues && firstCluster != null, "fixture has Cues before the first Cluster");
  assert.ok(cues.end < firstCluster, "cues sit in front of the media");

  const init = file.subarray(0, cues.start);
  const index = file.subarray(cues.start, cues.end + 1);
  const segments = parseCues(init, index, file.length, 12);
  assert.ok(segments.length >= 5, `expected clusters, got ${segments.length}`);
  assert.equal(segments[0].start, firstCluster, "first segment is the first cluster");
  assert.equal(segments.at(-1).end, file.length - 1);
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    assert.deepEqual([...file.subarray(s.start, s.start + 4)], [0x1f, 0x43, 0xb6, 0x75], `segment ${i} starts with a Cluster`);
    if (i) assert.equal(s.start, segments[i - 1].end + 1, "contiguous");
    assert.ok(s.dur > 0);
  }
  assert.ok(Math.abs(segments.at(-1).t0 + segments.at(-1).dur - 12) < 0.05, "covers 12 s");

  const chosen = chooseSegments(segments, 5, 8);
  const clipPath = join(dir, "clip.webm");
  writeFileSync(clipPath, Buffer.concat([init, file.subarray(chosen[0].start, chosen.at(-1).end + 1)]));
  const expected = chosen.at(-1).t0 + chosen.at(-1).dur - chosen[0].t0;
  assert.ok(Math.abs(probeVideoSeconds(clipPath, 30) - expected) < 0.3, `decoded ${probeVideoSeconds(clipPath, 30)} s ≈ ${expected}`);
});

test("chooseSegments picks the overlapping run", () => {
  const segments = [0, 5, 10, 15].map((t0) => ({ start: t0 * 100, end: t0 * 100 + 499, t0, dur: 5 }));
  assert.deepEqual(chooseSegments(segments, 6, 12).map((s) => s.t0), [5, 10]);
  assert.deepEqual(chooseSegments(segments, 5, 10).map((s) => s.t0), [5]);
  assert.throws(() => chooseSegments(segments, 40, 50), /outside the video/);
});
