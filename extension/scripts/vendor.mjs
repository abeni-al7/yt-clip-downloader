// Copies the third-party runtime files into extension/vendor/ (not committed):
//   - ffmpeg.wasm (@ffmpeg/ffmpeg ESM client + @ffmpeg/core ESM core, ~32 MB)
//   - yt-dlp's EJS challenge solver (lib.min.js + core.min.js) from the backend's locked venv,
//     so the extension solves YouTube's n/sig challenges with exactly the code yt-dlp uses.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor");
const nodeModules = join(root, "node_modules");

rmSync(vendor, { recursive: true, force: true });
mkdirSync(join(vendor, "ffmpeg"), { recursive: true });
mkdirSync(join(vendor, "ffmpeg-core"), { recursive: true });
mkdirSync(join(vendor, "ejs"), { recursive: true });

for (const name of readdirSync(join(nodeModules, "@ffmpeg/ffmpeg/dist/esm"))) {
  if (/\.(js|mjs)$/.test(name)) cpSync(join(nodeModules, "@ffmpeg/ffmpeg/dist/esm", name), join(vendor, "ffmpeg", name));
}
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  cpSync(join(nodeModules, "@ffmpeg/core/dist/esm", name), join(vendor, "ffmpeg-core", name));
}
for (const [pkg, dir] of [["@ffmpeg/ffmpeg", "ffmpeg"], ["@ffmpeg/core", "ffmpeg-core"]]) {
  const license = join(nodeModules, pkg, "LICENSE");
  if (existsSync(license)) cpSync(license, join(vendor, dir, "LICENSE"));
}

// The EJS bundles ship inside the yt-dlp-ejs wheel; the backend's uv lock pins their version.
const backend = resolve(root, "..", "backend");
const solverDir = execFileSync(
  "uv",
  ["run", "--frozen", "python", "-c", "import yt_dlp_ejs.yt.solver as s, os; print(os.path.dirname(s.__file__))"],
  { cwd: backend, encoding: "utf8" },
).trim();
for (const name of ["lib.min.js", "core.min.js"]) cpSync(join(solverDir, name), join(vendor, "ejs", name));
const ejsVersion = execFileSync(
  "uv",
  ["run", "--frozen", "python", "-c", "from importlib.metadata import version; print(version('yt-dlp-ejs'))"],
  { cwd: backend, encoding: "utf8" },
).trim();
writeFileSync(join(vendor, "ejs", "VERSION"), `${ejsVersion}\n`);

const total = ["ffmpeg", "ffmpeg-core", "ejs"]
  .flatMap((dir) => readdirSync(join(vendor, dir)).map((name) => statSync(join(vendor, dir, name)).size))
  .reduce((a, b) => a + b, 0);
console.log(`vendor/ ready (${(total / 1e6).toFixed(1)} MB): ffmpeg.wasm + yt-dlp-ejs ${ejsVersion}`);
