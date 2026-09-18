import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { toHms } from "../lib/format";

export interface Range {
  startS: number;
  endS: number;
}

interface Props {
  durationS: number;
  startS: number;
  endS: number;
  onChange: (range: Range) => void;
  /** Fires while the start handle moves so a preview can follow it. */
  onScrub?: (seconds: number) => void;
}

/** Visible window sizes; "0" means the whole video (ui-contract → Range selector behaviour). */
const ZOOM_LEVELS: { label: string; seconds: number }[] = [
  { label: "Whole video", seconds: 0 },
  { label: "30 min", seconds: 30 * 60 },
  { label: "5 min", seconds: 5 * 60 },
  { label: "1 min", seconds: 60 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Window of `size` seconds positioned around the selection, kept inside [0, duration]. */
export function visibleWindow(
  durationS: number,
  startS: number,
  endS: number,
  size: number,
): [number, number] {
  if (size <= 0 || size >= durationS) return [0, durationS];
  const span = endS - startS;
  const width = Math.max(size, span);
  const centre = (startS + endS) / 2;
  const min = clamp(Math.round(centre - width / 2), 0, durationS - width);
  return [min, min + width];
}

export function RangeSelector({ durationS, startS, endS, onChange, onScrub }: Props) {
  const [zoom, setZoom] = useState(0);
  const [min, max] = useMemo(
    () => visibleWindow(durationS, startS, endS, zoom),
    [durationS, startS, endS, zoom],
  );

  // If a zoom level no longer makes sense for this video, fall back to the whole video.
  useEffect(() => {
    if (zoom >= durationS) setZoom(0);
  }, [zoom, durationS]);

  const setStart = (value: number) => {
    const next = clamp(value, 0, Math.max(0, endS - 1));
    if (next !== startS) {
      onChange({ startS: next, endS });
      onScrub?.(next);
    }
  };

  const setEnd = (value: number) => {
    const next = clamp(value, Math.min(durationS, startS + 1), durationS);
    if (next !== endS) onChange({ startS, endS: next });
  };

  const keyStep = (event: KeyboardEvent<HTMLInputElement>): number | null => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        return event.shiftKey ? 10 : 1;
      case "ArrowLeft":
      case "ArrowDown":
        return event.shiftKey ? -10 : -1;
      case "PageUp":
        return 60;
      case "PageDown":
        return -60;
      default:
        return null;
    }
  };

  const onKey = (which: "start" | "end") => (event: KeyboardEvent<HTMLInputElement>) => {
    const step = keyStep(event);
    if (step === null) return;
    event.preventDefault();
    if (which === "start") setStart(startS + step);
    else setEnd(endS + step);
  };

  const pct = (value: number) => (max === min ? 0 : ((value - min) / (max - min)) * 100);

  return (
    <div className="range-selector">
      <div className="range-selector__track" aria-hidden="true">
        <div
          className="range-selector__selection"
          style={{ left: `${pct(startS)}%`, width: `${pct(endS) - pct(startS)}%` }}
        />
      </div>
      <div className="range-selector__inputs">
        <input
          type="range"
          className="range-selector__handle"
          aria-label="Start"
          min={min}
          max={max}
          step={1}
          value={clamp(startS, min, max)}
          aria-valuetext={toHms(startS)}
          onChange={(event) => setStart(Number(event.target.value))}
          onKeyDown={onKey("start")}
        />
        <input
          type="range"
          className="range-selector__handle"
          aria-label="End"
          min={min}
          max={max}
          step={1}
          value={clamp(endS, min, max)}
          aria-valuetext={toHms(endS)}
          onChange={(event) => setEnd(Number(event.target.value))}
          onKeyDown={onKey("end")}
        />
      </div>
      <div className="range-selector__footer">
        <span className="note" aria-hidden="true">
          {toHms(min)} – {toHms(max)}
        </span>
        <label className="range-selector__zoom">
          <span>Zoom</span>
          <select
            aria-label="Zoom"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            {ZOOM_LEVELS.filter((z) => z.seconds === 0 || z.seconds < durationS).map((z) => (
              <option key={z.seconds} value={z.seconds}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
