import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, toHms } from "../../src/lib/format";
import { parseTimestamp } from "../../src/lib/timestamps";

describe("parseTimestamp", () => {
  it.each([
    ["65", 65],
    ["0", 0],
    ["1:05", 65],
    ["1:65", 125],
    ["00:01:00", 60],
    ["1:2:3", 3723],
    ["1h5m", 3900],
    ["90s", 90],
    ["1h2m3s", 3723],
    [" 1:05 ", 65],
    ["1H5M", 3900],
  ])("parses %s", (text, expected) => {
    expect(parseTimestamp(text)).toBe(expected);
  });

  it.each(["", "abc", "1:2:3:4", "1:60:00", "-5", "1.5", "h", "1:", ":30"])(
    "rejects %s",
    (text) => {
      expect(parseTimestamp(text)).toBeNull();
    },
  );
});

describe("format helpers", () => {
  it("formats HH:MM:SS", () => {
    expect(toHms(0)).toBe("00:00:00");
    expect(toHms(3723)).toBe("01:02:03");
  });

  it("formats human durations", () => {
    expect(formatDuration(30)).toBe("30 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(4320)).toBe("1 h 12 min");
    expect(formatDuration(7200)).toBe("2 h");
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(12_000_000)).toBe("12 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
  });
});
