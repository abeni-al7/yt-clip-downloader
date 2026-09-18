import { type FormEvent, useState } from "react";

import { copy } from "../copy";
import { parseYoutubeUrl } from "../lib/youtubeUrl";
import { ErrorMessage } from "./ErrorMessage";

interface Props {
  disabled: boolean;
  busy: boolean;
  /** Server-side error for the current URL, shown under the field. */
  serverError: string | null;
  onSubmit: (url: string) => void;
}

export function UrlInput({ disabled, busy, serverError, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const submit = (text: string) => {
    const parsed = parseYoutubeUrl(text);
    if (!parsed.ok) {
      setClientError(parsed.error === "playlist_only" ? copy.playlist_only : copy.not_youtube);
      return;
    }
    setClientError(null);
    onSubmit(text.trim());
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && value.trim()) submit(value);
  };

  const error = clientError ?? serverError;

  return (
    <form className="card" onSubmit={handleSubmit} aria-label="Video link">
      <label htmlFor="url">YouTube link</label>
      <div className="row">
        <input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
          value={value}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "url-error" : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setClientError(null);
          }}
          onPaste={(event) => {
            // Auto-submit a pasted link so the common path is a single action.
            const pasted = event.clipboardData.getData("text");
            if (!disabled && parseYoutubeUrl(pasted).ok) {
              event.preventDefault();
              setValue(pasted);
              submit(pasted);
            }
          }}
        />
        <button type="submit" className="button" disabled={disabled || busy || !value.trim()}>
          {busy ? "Loading…" : "Load video"}
        </button>
      </div>
      {error && <ErrorMessage id="url-error" message={error} />}
    </form>
  );
}
