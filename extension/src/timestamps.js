// Timestamp grammar shared with the backend: `SS`, `MM:SS`, `HH:MM:SS`, `[Nh][Nm][Ns]`.

const DIGITS = /^\d+$/;
const HMS = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/** Whole seconds, or throws for anything outside the grammar. */
export function parseTimestamp(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) throw new Error("Enter a time like 1:30, 90 or 1m30s.");
  if (DIGITS.test(text)) return Number.parseInt(text, 10);
  if (text.includes(":")) {
    const parts = text.split(":");
    if (![2, 3].includes(parts.length) || !parts.every((part) => DIGITS.test(part))) {
      throw new Error(`"${value}" is not a time. Use MM:SS or HH:MM:SS.`);
    }
    const numbers = parts.map((part) => Number.parseInt(part, 10));
    if (numbers.length === 3) {
      const [hours, minutes, seconds] = numbers;
      if (minutes > 59 || seconds > 59) throw new Error("Minutes and seconds must be below 60 in HH:MM:SS.");
      return hours * 3600 + minutes * 60 + seconds;
    }
    const [minutes, seconds] = numbers; // MM:SS is deliberately lenient: "1:65" means 125 seconds.
    return minutes * 60 + seconds;
  }
  const match = HMS.exec(text);
  if (!match || !(match[1] || match[2] || match[3])) throw new Error(`"${value}" is not a time. Use MM:SS, HH:MM:SS or 1h2m3s.`);
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function split(seconds) {
  const total = Math.max(0, Math.trunc(seconds));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
}

const pad = (n) => String(n).padStart(2, "0");

export function formatHms(seconds) {
  const [h, m, s] = split(seconds);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatHmsForFilename(seconds) {
  const [h, m, s] = split(seconds);
  return `${pad(h)}-${pad(m)}-${pad(s)}`;
}
