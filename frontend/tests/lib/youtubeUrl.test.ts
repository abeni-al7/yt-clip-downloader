import { describe, expect, it } from "vitest";

import { parseYoutubeUrl } from "../../src/lib/youtubeUrl";

const VID = "dQw4w9WgXcQ";

describe("parseYoutubeUrl", () => {
  it.each([
    `https://www.youtube.com/watch?v=${VID}`,
    `youtube.com/watch?v=${VID}`,
    `https://m.youtube.com/watch?v=${VID}&feature=share`,
    `https://music.youtube.com/watch?v=${VID}&list=RD123`,
    `https://youtu.be/${VID}`,
    `youtu.be/${VID}?si=abc`,
    `https://www.youtube.com/shorts/${VID}`,
    `https://www.youtube.com/live/${VID}`,
    `https://www.youtube-nocookie.com/embed/${VID}`,
    `https://www.youtube.com/v/${VID}`,
    `https://www.youtube.com/watch?v=${VID}&list=PLxyz&index=3`,
    VID,
  ])("accepts %s", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({ ok: true, videoId: VID, startHintS: null });
  });

  it.each([
    [`https://youtu.be/${VID}?t=90`, 90],
    [`https://www.youtube.com/watch?v=${VID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${VID}&start=45`, 45],
    [`https://www.youtube.com/watch?v=${VID}#t=75`, 75],
    [`https://www.youtube.com/watch?v=${VID}&t=bogus`, null],
  ])("reads the start hint from %s", (url, hint) => {
    const parsed = parseYoutubeUrl(url);
    expect(parsed.ok && parsed.startHintS).toBe(hint);
  });

  it.each([
    "https://example.com/watch?v=" + VID,
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/watch?v=short",
    "not a url",
    "",
  ])("rejects %s as not_youtube", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({ ok: false, error: "not_youtube" });
  });

  it("flags playlist-only links", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/playlist?list=PLxyz")).toEqual({
      ok: false,
      error: "playlist_only",
    });
  });
});
