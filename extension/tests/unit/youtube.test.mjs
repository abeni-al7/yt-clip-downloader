import assert from "node:assert/strict";
import { test } from "node:test";

import { ResolveError, classifyPlayability, finalizeUrl, normalizeFormat, parseYtcfg } from "../../src/youtube.js";

test("ytcfg is lifted out of the embed page", () => {
  const html = `<script>ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"clientName":"WEB_EMBEDDED_PLAYER","clientVersion":"1.2"}},"INNERTUBE_CONTEXT_CLIENT_NAME":56,"WEB_PLAYER_CONTEXT_CONFIGS":{"WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER":{"jsUrl":"/s/player/abc/player_ias.vflset/en_US/base.js","encryptedHostFlags":"xyz"}}});</script>`;
  const cfg = parseYtcfg(html);
  assert.equal(cfg.INNERTUBE_CONTEXT_CLIENT_NAME, 56);
  assert.equal(cfg.WEB_PLAYER_CONTEXT_CONFIGS.WEB_PLAYER_CONTEXT_CONFIG_ID_EMBEDDED_PLAYER.encryptedHostFlags, "xyz");
  assert.throws(() => parseYtcfg("<html>nothing</html>"), ResolveError);
});

test("playability statuses map to the app's error codes", () => {
  const code = (playabilityStatus, videoDetails = {}) => classifyPlayability({ playabilityStatus, videoDetails })?.code ?? null;
  assert.equal(code({ status: "OK" }), null);
  assert.equal(code({ status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" }), "bot_check");
  assert.equal(code({ status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" }), "age_restricted");
  assert.equal(code({ status: "LOGIN_REQUIRED", reason: "This video is private" }), "private");
  assert.equal(code({ status: "UNPLAYABLE", reason: "Playback on other websites has been disabled by the video owner" }), "embedding_disabled");
  assert.equal(code({ status: "UNPLAYABLE", reason: "Join this channel to get access to members-only content" }), "members_only");
  assert.equal(code({ status: "UNPLAYABLE", reason: "The uploader has not made this video available in your country" }), "geo_blocked");
  assert.equal(code({ status: "ERROR", reason: "Video unavailable" }), "video_unavailable");
  assert.equal(code({ status: "LIVE_STREAM_OFFLINE", reason: "Premieres in 2 hours" }), "live_in_progress");
  assert.equal(code({ status: "OK" }, { isLive: true }), "live_in_progress");
  assert.match(classifyPlayability({ playabilityStatus: { status: "ERROR", reason: "Video unavailable" } }).message, /Video unavailable/);
});

const RAW_CIPHERED = {
  itag: 137,
  mimeType: 'video/mp4; codecs="avc1.640028"',
  bitrate: 4_500_000,
  averageBitrate: 4_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  qualityLabel: "1080p",
  contentLength: "123456789",
  approxDurationMs: "635000",
  initRange: { start: "0", end: "740" },
  indexRange: { start: "741", end: "2200" },
  signatureCipher: "s=AAsigABC&sp=sig&url=" + encodeURIComponent("https://rr1---sn-test.googlevideo.com/videoplayback?expire=1&itag=137&n=nChallenge&mime=video%2Fmp4"),
};

test("adaptive formats are normalised; OTF, DRM and index-less ones are dropped", () => {
  const f = normalizeFormat(RAW_CIPHERED);
  assert.equal(f.container, "mp4");
  assert.equal(f.vcodec, "avc1");
  assert.equal(f.acodec, null);
  assert.equal(f.height, 1080);
  assert.equal(f.bitrate, 4_000_000, "average bitrate wins for size estimates");
  assert.equal(f.contentLength, 123456789);
  assert.deepEqual(f.indexRange, { start: 741, end: 2200 });
  assert.equal(f.decoded.s, "AAsigABC");
  assert.equal(f.decoded.sp, "sig");

  const audio = normalizeFormat({ ...RAW_CIPHERED, itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', height: undefined, url: "https://x.googlevideo.com/videoplayback?n=abc", signatureCipher: undefined });
  assert.equal(audio.acodec, "mp4a");
  assert.equal(audio.vcodec, null);
  assert.equal(audio.height, 0);

  assert.equal(normalizeFormat({ ...RAW_CIPHERED, type: "FORMAT_STREAM_TYPE_OTF" }), null);
  assert.equal(normalizeFormat({ ...RAW_CIPHERED, drmFamilies: ["WIDEVINE"] }), null);
  assert.equal(normalizeFormat({ ...RAW_CIPHERED, indexRange: undefined }), null);
  assert.equal(normalizeFormat({ ...RAW_CIPHERED, mimeType: 'application/x-mpegURL; codecs="avc1"' }), null);
});

test("solved challenges are written back into the URL", () => {
  const f = normalizeFormat(RAW_CIPHERED);
  const solved = { n: new Map([["nChallenge", "nSolved"]]), sig: new Map([["AAsigABC", "CBAgisAA"]]) };
  const url = new URL(finalizeUrl(f, solved));
  assert.equal(url.searchParams.get("n"), "nSolved");
  assert.equal(url.searchParams.get("sig"), "CBAgisAA");
  assert.equal(url.searchParams.get("itag"), "137");
  assert.throws(() => finalizeUrl(f, { n: new Map(), sig: new Map() }), /n challenge/);
});
