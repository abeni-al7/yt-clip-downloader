import type { OutputFormat, VideoInfo } from "../api/client";
import { copy } from "../copy";

interface Props {
  video: VideoInfo;
  format: OutputFormat;
  value: number | null;
  onChange: (height: number) => void;
}

/** Resolution choice for video formats only; lists what the video actually offers (FR-011). */
export function QualityPicker({ video, format, value, onChange }: Props) {
  if (format !== "mp4" && format !== "webm") return null;
  const variants = video.resolutions[format];
  if (variants.length === 0) return null;
  const selected = variants.find((v) => v.height === value) ?? null;
  const showCodecNote = format === "mp4" && selected !== null && selected.vcodec !== "avc1";

  return (
    <fieldset className="quality-picker">
      <legend>Quality</legend>
      <div className="quality-picker__options" role="radiogroup" aria-label="Quality">
        {variants.map((variant) => {
          const id = `quality-${variant.height}`;
          return (
            <label key={variant.height} className="choice choice--compact" htmlFor={id}>
              <input
                id={id}
                type="radio"
                name="quality"
                value={variant.height}
                checked={value === variant.height}
                onChange={() => onChange(variant.height)}
              />
              <span className="choice__label">
                {variant.height}p{variant.fps > 30 ? variant.fps : ""}
              </span>
            </label>
          );
        })}
      </div>
      {showCodecNote && <p className="note">{copy.mp4_hi_res_note}</p>}
    </fieldset>
  );
}
