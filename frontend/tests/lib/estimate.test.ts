import { describe, expect, it } from "vitest";

import type { VideoInfo } from "../../src/api/client";
import {
  OVERHEAD_FACTOR,
  TRANSCODED_AUDIO_KBPS,
  audioKbpsFor,
  estimateBytes,
  estimateForSelection,
} from "../../src/lib/estimate";

const video: VideoInfo = {
  video_id: "dQw4w9WgXcQ",
  canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "T",
  channel: "C",
  thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
  duration_s: 600,
  embeddable: true,
  has_audio: true,
  resolutions: {
    mp4: [
      { height: 1080, fps: 30, vcodec: "avc1", video_kbps: 4000 },
      { height: 720, fps: 30, vcodec: "avc1", video_kbps: 2500 },
    ],
    webm: [{ height: 1080, fps: 30, vcodec: "vp9", video_kbps: 3000 }],
  },
  audio: { m4a_kbps: 128, opus_kbps: 140 },
  start_hint_s: null,
};

describe("estimateBytes", () => {
  it("is duration × kbps / 8 with container overhead", () => {
    const bytes = estimateBytes({ durationS: 30, videoKbps: 4000, audioKbps: 128 });
    expect(bytes).toBe(Math.round((30 * 4128 * 1000 * OVERHEAD_FACTOR) / 8));
  });

  it("never goes negative", () => {
    expect(estimateBytes({ durationS: -5, videoKbps: 100, audioKbps: 0 })).toBe(0);
  });
});

describe("audioKbpsFor", () => {
  it("picks the codec the container will carry", () => {
    expect(audioKbpsFor("mp4", video.audio)).toBe(128);
    expect(audioKbpsFor("m4a", video.audio)).toBe(128);
    expect(audioKbpsFor("webm", video.audio)).toBe(140);
    expect(audioKbpsFor("opus", video.audio)).toBe(140);
    expect(audioKbpsFor("mp3", video.audio)).toBe(TRANSCODED_AUDIO_KBPS);
    expect(audioKbpsFor("ogg", video.audio)).toBe(TRANSCODED_AUDIO_KBPS);
  });
});

describe("estimateForSelection", () => {
  it("uses the selected variant's bitrate for video formats", () => {
    const bytes = estimateForSelection({ video, format: "mp4", height: 720, startS: 0, endS: 60 });
    expect(bytes).toBe(estimateBytes({ durationS: 60, videoKbps: 2500, audioKbps: 128 }));
  });

  it("uses audio only for audio formats", () => {
    const bytes = estimateForSelection({ video, format: "mp3", height: null, startS: 0, endS: 60 });
    expect(bytes).toBe(estimateBytes({ durationS: 60, videoKbps: 0, audioKbps: 190 }));
  });
});
