import { useEffect, useState } from "react";

import { copy } from "../copy";
import { toHms } from "../lib/format";
import { parseTimestamp } from "../lib/timestamps";
import { ErrorMessage } from "./ErrorMessage";

interface Props {
  id: string;
  label: string;
  valueS: number;
  /** Called with the parsed seconds; the parent clamps and validates. */
  onChange: (seconds: number) => void;
  /** Extra message from the parent (e.g. end-before-start), shown under the field. */
  error?: string | null;
  note?: string | null;
}

export function TimestampField({ id, label, valueS, onChange, error, note }: Props) {
  const [text, setText] = useState(toHms(valueS));
  const [parseError, setParseError] = useState<string | null>(null);
  const [commits, setCommits] = useState(0);

  // Re-sync after external changes (slider, clamping) and after every commit — even when the
  // parent clamps back to the same value — without fighting the user's typing.
  useEffect(() => {
    setText(toHms(valueS));
    setParseError(null);
  }, [valueS, commits]);

  const commit = () => {
    const parsed = parseTimestamp(text);
    if (parsed === null) {
      setParseError(copy.bad_timestamp);
      return;
    }
    setParseError(null);
    setCommits((n) => n + 1);
    if (parsed !== valueS) onChange(parsed);
  };

  const nudge = (delta: number) => onChange(Math.max(0, valueS + delta));
  const shownError = parseError ?? error ?? null;
  const errorId = `${id}-error`;

  return (
    <div className="timestamp-field">
      <label htmlFor={id}>{label}</label>
      <div className="timestamp-field__controls">
        <button
          type="button"
          className="button button--small"
          aria-label={`${label}: one second earlier`}
          onClick={() => nudge(-1)}
        >
          −1 s
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          aria-invalid={shownError ? "true" : undefined}
          aria-describedby={shownError ? errorId : undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          className="button button--small"
          aria-label={`${label}: one second later`}
          onClick={() => nudge(1)}
        >
          +1 s
        </button>
      </div>
      {shownError && <ErrorMessage id={errorId} message={shownError} />}
      {!shownError && note && <p className="note">{note}</p>}
    </div>
  );
}
