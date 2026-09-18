// Packs the loadable extension (everything Chrome needs, nothing else) into dist/yt-clip-extension.zip.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, "vendor", "ffmpeg-core", "ffmpeg-core.wasm"))) {
  console.error("vendor/ is missing — run `npm run vendor` first.");
  process.exit(1);
}
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const out = join(dist, "yt-clip-extension.zip");
rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "manifest.json", "ui.html", "ui.css", "sandbox.html", "icons", "src", "vendor"], { cwd: root, stdio: "inherit" });
console.log(`wrote ${out}`);
