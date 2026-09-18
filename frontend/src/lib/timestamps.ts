/** Client mirror of the server's timestamp grammar (backend/src/ytclip/domain/timestamps.py). */

const DIGITS = /^[0-9]+$/;
const HMS = /^(?:([0-9]+)h)?(?:([0-9]+)m)?(?:([0-9]+)s)?$/;

/** `SS`, `MM:SS`, `HH:MM:SS`, `1h5m30s` → whole seconds, or null when unparseable. */
export function parseTimestamp(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  if (DIGITS.test(text)) return Number(text);

  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length < 2 || parts.length > 3 || !parts.every((p) => DIGITS.test(p))) return null;
    const numbers = parts.map(Number);
    if (numbers.length === 3) {
      const [h, m, s] = numbers as [number, number, number];
      if (m > 59 || s > 59) return null;
      return h * 3600 + m * 60 + s;
    }
    const [m, s] = numbers as [number, number];
    return m * 60 + s; // "1:65" is deliberately accepted as 125 s
  }

  const match = HMS.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    return null;
  }
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  const s = Number(match[3] ?? 0);
  return h * 3600 + m * 60 + s;
}

export { toHms } from "./format";
