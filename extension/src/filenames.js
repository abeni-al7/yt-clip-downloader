// Download file naming, mirroring backend/src/ytclip/domain/filenames.py.
import { formatHmsForFilename } from "./timestamps.js";

const MAX_TITLE_CHARS = 120;

export function sanitizeTitle(title) {
  const cleaned = String(title || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_TITLE_CHARS).replace(/[ .]+$/, "") || "clip";
}

export function downloadFilename(title, startS, endS, extension) {
  return `${sanitizeTitle(title)} [${formatHmsForFilename(startS)}-${formatHmsForFilename(endS)}].${extension}`;
}
