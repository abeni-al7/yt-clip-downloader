// End-to-end: load the unpacked extension into the installed Google Chrome, cut real clips through
// the page exactly as a user would, and check the downloaded files with ffprobe.
// Needs network access to YouTube. Run: npm run test:e2e   (HEADED=1 to watch it)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "tests", "e2e", "out");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const VIDEO = process.env.YTCLIP_E2E_VIDEO || "aqz-KE-bpKQ"; // Big Buck Bunny, 10:35, CC-BY
const CASES = [
  { format: "mp4", quality: "720", start: "1:00", end: "1:15", expectVideo: "h264", expectAudio: "aac" },
  { format: "webm", quality: "720", start: "2:00", end: "2:10", expectVideo: "vp9", expectAudio: "opus" },
  { format: "mp3", start: "0:30", end: "0:45", expectVideo: null, expectAudio: "mp3" },
  { format: "m4a", start: "0:30", end: "0:40", expectVideo: null, expectAudio: "aac" },
  { format: "opus", start: "0:30", end: "0:40", expectVideo: null, expectAudio: "opus" },
  { format: "ogg", start: "0:30", end: "0:40", expectVideo: null, expectAudio: "vorbis" },
];

function probe(path) {
  const json = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height", "-of", "json", path],
    { encoding: "utf8" },
  );
  const data = JSON.parse(json);
  return {
    duration: Number(data.format.duration),
    container: data.format.format_name,
    video: data.streams.find((s) => s.codec_type === "video") || null,
    audio: data.streams.find((s) => s.codec_type === "audio") || null,
  };
}

const userDataDir = mkdtempSync(join(tmpdir(), "ytclip-e2e-"));
const headless = !process.env.HEADED;
// Google Chrome 137+ ignores --load-extension; load through CDP instead (needs the debugging flag).
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chrome",
  headless,
  acceptDownloads: true,
  ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
  args: ["--enable-unsafe-extension-debugging", "--no-first-run"],
});

let failures = 0;
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: root });
  console.log(`extension ${extensionId} loaded (${headless ? "headless" : "headed"})`);

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") console.log(`  [page ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));

  await page.goto(`chrome-extension://${extensionId}/ui.html?v=${VIDEO}`);
  await page.locator("#video:not(.hidden)").waitFor({ timeout: 60_000 });
  const title = await page.locator("#title").textContent();
  const byline = await page.locator("#byline").textContent();
  console.log(`resolved: "${title}" — ${byline}`);
  const qualities = await page.locator("#quality option").allTextContents();
  console.log(`mp4 qualities: ${qualities.join(", ")}`);

  for (const c of CASES) {
    const started = Date.now();
    await page.selectOption("#format", c.format);
    if (c.quality) await page.selectOption("#quality", c.quality);
    await page.fill("#start", c.start);
    await page.fill("#end", c.end);
    const estimate = await page.locator("#estimate").textContent();
    const downloadPromise = page.waitForEvent("download", { timeout: 300_000 });
    await page.click("#download");
    const download = await downloadPromise;
    const path = join(outDir, download.suggestedFilename());
    await download.saveAs(path);
    await page.locator("#done:not(.hidden)").waitFor({ timeout: 60_000 });
    const done = await page.locator("#done").textContent();
    const info = probe(path);
    const [h1, m1, s1 = 0] = [0, ...c.start.split(":").map(Number)].slice(-3);
    const [h2, m2, s2 = 0] = [0, ...c.end.split(":").map(Number)].slice(-3);
    const requested = h2 * 3600 + m2 * 60 + s2 - (h1 * 3600 + m1 * 60 + s1);
    const okVideo = c.expectVideo ? info.video?.codec_name === c.expectVideo && info.video.height === Number(c.quality) : info.video === null;
    const okAudio = info.audio?.codec_name === c.expectAudio;
    // Video clips start at the keyframe before `start` and end 1 s after `end`; audio clips are exact.
    const okDuration = c.expectVideo ? info.duration >= requested + 0.5 && info.duration <= requested + 8 : Math.abs(info.duration - requested) < 0.5;
    const ok = okVideo && okAudio && okDuration;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.format}${c.quality ? ` ${c.quality}p` : ""} ${c.start}-${c.end}: ${download.suggestedFilename()} | ${info.container} ` +
        `video=${info.video ? `${info.video.codec_name} ${info.video.width}x${info.video.height}` : "none"} audio=${info.audio?.codec_name} ` +
        `duration=${info.duration.toFixed(2)}s (requested ${requested}s) | ${((Date.now() - started) / 1000).toFixed(1)}s | estimate: ${estimate} | ${done}`,
    );
  }
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
if (failures) {
  console.log(`${failures} case(s) failed`);
  process.exit(1);
}
console.log("all e2e cases passed");
