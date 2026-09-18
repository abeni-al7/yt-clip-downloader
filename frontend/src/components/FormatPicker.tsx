import type { OutputFormat, VideoInfo } from "../api/client";
import { copy } from "../copy";

interface Props {
  video: VideoInfo;
  value: OutputFormat;
  onChange: (format: OutputFormat) => void;
}

const VIDEO_FORMATS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: "mp4", label: "MP4", hint: "Plays everywhere" },
  { value: "webm", label: "WebM", hint: "Smaller, VP9" },
];

const AUDIO_FORMATS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: "mp3", label: "MP3", hint: "Universal audio" },
  { value: "m4a", label: "M4A", hint: "AAC, Apple-friendly" },
  { value: "ogg", label: "OGG", hint: "Vorbis" },
  { value: "opus", label: "Opus", hint: "Best quality per byte" },
];

const CONVERTED = new Set<OutputFormat>(["mp3", "ogg"]);

export function FormatPicker({ video, value, onChange }: Props) {
  const webmUnavailable = video.resolutions.webm.length === 0;
  const audioUnavailable = !video.has_audio;

  const option = (
    kind: "Video" | "Audio",
    { value: format, label, hint }: { value: OutputFormat; label: string; hint: string },
  ) => {
    const disabled =
      (format === "webm" && webmUnavailable) || (kind === "Audio" && audioUnavailable);
    const id = `format-${format}`;
    return (
      <label key={format} className={`choice ${disabled ? "choice--disabled" : ""}`} htmlFor={id}>
        <input
          id={id}
          type="radio"
          name="format"
          value={format}
          checked={value === format}
          disabled={disabled}
          onChange={() => onChange(format)}
        />
        <span className="choice__label">
          {label} <span className="choice__kind">{kind}</span>
        </span>
        <span className="choice__hint">
          {disabled && format === "webm"
            ? copy.no_webm
            : disabled
              ? copy.no_audio
              : CONVERTED.has(format)
                ? copy.audio_convert_note
                : hint}
        </span>
      </label>
    );
  };

  return (
    <fieldset className="format-picker">
      <legend>Format</legend>
      <div className="format-picker__group" role="group" aria-label="Video formats">
        {VIDEO_FORMATS.map((f) => option("Video", f))}
      </div>
      <div className="format-picker__group" role="group" aria-label="Audio formats">
        {AUDIO_FORMATS.map((f) => option("Audio", f))}
      </div>
    </fieldset>
  );
}
