import assert from "node:assert/strict";
import { test } from "node:test";

import { planClip } from "../../src/clip.js";
import { OUTPUTS, estimateBytes, parseMimeType, pickAudio, pickVideo, resolutions } from "../../src/formats.js";

// A trimmed, YouTube-shaped format inventory (already normalised).
const fmt = (over) => ({
  itag: 0,
  container: "mp4",
  vcodec: null,
  acodec: null,
  height: 0,
  fps: 0,
  bitrate: 0,
  contentLength: 1,
  approxDurationMs: 635_000,
  initRange: { start: 0, end: 700 },
  indexRange: { start: 701, end: 1500 },
  url: "https://rr1---sn-test.googlevideo.com/videoplayback?itag=0",
  ...over,
});
export const FORMATS = [
  fmt({ itag: 136, vcodec: "avc1", height: 720, fps: 30, bitrate: 2_496_430 }),
  fmt({ itag: 298, vcodec: "avc1", height: 720, fps: 60, bitrate: 4_206_005 }),
  fmt({ itag: 398, vcodec: "av01", height: 720, fps: 60, bitrate: 2_603_249 }),
  fmt({ itag: 299, vcodec: "avc1", height: 1080, fps: 60, bitrate: 6_933_529 }),
  fmt({ itag: 401, vcodec: "av01", height: 2160, fps: 60, bitrate: 17_443_607 }),
  fmt({ itag: 247, container: "webm", vcodec: "vp9", height: 720, fps: 30, bitrate: 1_862_827 }),
  fmt({ itag: 303, container: "webm", vcodec: "vp9", height: 1080, fps: 60, bitrate: 4_652_291 }),
  fmt({ itag: 315, container: "webm", vcodec: "vp9", height: 2160, fps: 60, bitrate: 26_523_399 }),
  fmt({ itag: 140, acodec: "mp4a", bitrate: 130_992 }),
  fmt({ itag: 251, container: "webm", acodec: "opus", bitrate: 140_000 }),
  fmt({ itag: 250, container: "webm", acodec: "opus", bitrate: 75_580 }),
];
export const VIDEO = { videoId: "aqz-KE-bpKQ", title: "Big Buck Bunny", author: "Blender", durationS: 635, thumbnail: "", formats: FORMATS };

test("mime types", () => {
  assert.deepEqual(parseMimeType('video/mp4; codecs="avc1.64002a"'), { kind: "video", container: "mp4", codecs: "avc1.64002a" });
  assert.deepEqual(parseMimeType('audio/webm; codecs="opus"'), { kind: "audio", container: "webm", codecs: "opus" });
});

test("resolutions per container: best variant per height, highest first", () => {
  assert.deepEqual(
    resolutions(FORMATS, "mp4").map((r) => [r.height, r.fps, r.vcodec]),
    [
      [2160, 60, "av01"],
      [1080, 60, "avc1"],
      [720, 60, "avc1"], // avc1 preferred over av01 in mp4, 60 fps over 30
    ],
  );
  assert.deepEqual(
    resolutions(FORMATS, "webm").map((r) => r.height),
    [2160, 1080, 720],
  );
});

test("picking never falls back to a lower height", () => {
  assert.equal(pickVideo(FORMATS, "mp4", 720).itag, 298);
  assert.equal(pickVideo(FORMATS, "mp4", 2160).itag, 401);
  assert.equal(pickVideo(FORMATS, "webm", 720).itag, 247);
  assert.equal(pickVideo(FORMATS, "mp4", 480), null);
});

test("audio: natural codec first, best other codec otherwise", () => {
  assert.equal(pickAudio(FORMATS, "mp4").itag, 140);
  assert.equal(pickAudio(FORMATS, "m4a").itag, 140);
  assert.equal(pickAudio(FORMATS, "webm").itag, 251);
  assert.equal(pickAudio(FORMATS, "opus").itag, 251);
  assert.equal(pickAudio(FORMATS, "mp3").itag, 251); // highest bitrate of any codec; mp3 always transcodes
  assert.equal(pickAudio(FORMATS.filter((f) => f.acodec !== "mp4a"), "m4a").itag, 251); // will be transcoded to aac
  assert.equal(pickAudio(FORMATS.filter((f) => !f.acodec), "mp4"), null);
});

test("estimate", () => {
  assert.equal(estimateBytes(FORMATS[0], FORMATS[8], 10), Math.round(((2_496_430 + 130_992) / 8) * 10));
  assert.equal(Object.keys(OUTPUTS).length, 6);
});

test("planClip validates the request and chooses sources", () => {
  const plan = planClip(VIDEO, { outputKey: "mp4", height: 720, startS: 60, endS: 75 });
  assert.equal(plan.videoFormat.itag, 298);
  assert.equal(plan.audioFormat.itag, 140);
  assert.equal(plan.endS, 75);
  assert.ok(plan.estimatedBytes > 0);

  const audioOnly = planClip(VIDEO, { outputKey: "mp3", height: null, startS: 0, endS: 9999 });
  assert.equal(audioOnly.videoFormat, null);
  assert.equal(audioOnly.endS, 635, "end is clamped to the duration");

  assert.throws(() => planClip(VIDEO, { outputKey: "mp4", height: 720, startS: 75, endS: 60 }), /end must be after/);
  assert.throws(() => planClip(VIDEO, { outputKey: "mp4", height: 720, startS: 700, endS: 710 }), /only 635 seconds/);
  assert.throws(() => planClip(VIDEO, { outputKey: "mp4", height: 480, startS: 0, endS: 10 }), /480p is not available/);
  assert.throws(() => planClip(VIDEO, { outputKey: "webm", height: null, startS: 0, endS: 10 }), /Choose a resolution/);
  assert.throws(() => planClip(VIDEO, { outputKey: "gif", height: null, startS: 0, endS: 10 }), /Choose an output format/);
});
