import assert from "node:assert/strict";
import { test } from "node:test";

import { downloadFilename, sanitizeTitle } from "../../src/filenames.js";
import { formatHms, formatHmsForFilename, parseTimestamp } from "../../src/timestamps.js";

test("timestamp grammar mirrors the backend", () => {
  assert.equal(parseTimestamp("90"), 90);
  assert.equal(parseTimestamp("1:30"), 90);
  assert.equal(parseTimestamp("1:65"), 125); // MM:SS is lenient
  assert.equal(parseTimestamp("1:02:03"), 3723);
  assert.equal(parseTimestamp("1h2m3s"), 3723);
  assert.equal(parseTimestamp("2m"), 120);
  assert.equal(parseTimestamp(" 45s "), 45);
  for (const bad of ["", "abc", "1:2:3:4", "1:60:00", "1:00:60", "-5", "1.5"]) {
    assert.throws(() => parseTimestamp(bad), bad);
  }
});

test("formatting", () => {
  assert.equal(formatHms(3725), "01:02:05");
  assert.equal(formatHms(0), "00:00:00");
  assert.equal(formatHmsForFilename(61), "00-01-01");
});

test("file names are safe and carry the window", () => {
  assert.equal(sanitizeTitle('A/B: "quoted" <title>?  '), "A_B_ _quoted_ _title__");
  assert.equal(sanitizeTitle("..."), "clip");
  assert.equal(sanitizeTitle("x".repeat(200)).length, 120);
  assert.equal(downloadFilename("My Video", 5, 65, "mp4"), "My Video [00-00-05-00-01-05].mp4");
});
