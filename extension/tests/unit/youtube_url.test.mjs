import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalUrl, parseStartHint, parseYoutubeUrl } from "../../src/youtube_url.js";

test("recognises the usual link shapes", () => {
  const id = "aqz-KE-bpKQ";
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PLx&index=2`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/v/${id}`,
    id,
  ]) {
    assert.equal(parseYoutubeUrl(link)?.videoId, id, link);
  }
});

test("rejects playlists, channels and other sites", () => {
  for (const link of [
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@channel",
    "https://vimeo.com/12345",
    "https://www.youtube.com/watch?v=short",
    "",
    "not a url",
  ]) {
    assert.equal(parseYoutubeUrl(link), null, link);
  }
});

test("reads start hints in every grammar", () => {
  assert.equal(parseYoutubeUrl("https://youtu.be/aqz-KE-bpKQ?t=90").startHintS, 90);
  assert.equal(parseYoutubeUrl("https://youtu.be/aqz-KE-bpKQ?t=90s").startHintS, 90);
  assert.equal(parseYoutubeUrl("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s").startHintS, 90);
  assert.equal(parseYoutubeUrl("https://www.youtube.com/watch?v=aqz-KE-bpKQ&start=65").startHintS, 65);
  assert.equal(parseYoutubeUrl("https://www.youtube.com/watch?v=aqz-KE-bpKQ#t=1h2m3s").startHintS, 3723);
  assert.equal(parseStartHint("1:02:03"), 3723);
  assert.equal(parseStartHint("bogus"), null);
});

test("canonical url", () => {
  assert.equal(canonicalUrl("aqz-KE-bpKQ"), "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
});
