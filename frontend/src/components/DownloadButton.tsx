import { formatDuration } from "../lib/format";

interface Props {
  /** Fully built /api/clip URL, or null when the form is not ready. */
  href: string | null;
  durationS: number;
  /** Why the button is disabled, announced to assistive tech. */
  disabledReason?: string | null;
  onClick: () => void;
}

/**
 * A real anchor opened in a new tab: the response carries Content-Disposition: attachment, so the
 * browser downloads it with its own progress UI and no CORS is involved (research R7).
 */
export function DownloadButton({ href, durationS, disabledReason, onClick }: Props) {
  const label = `Download ${formatDuration(durationS)} clip`;
  if (!href) {
    return (
      <button
        type="button"
        className="button button--primary"
        aria-disabled="true"
        disabled
        title={disabledReason ?? undefined}
      >
        {label}
      </button>
    );
  }
  return (
    <a
      className="button button--primary"
      href={href}
      target="_blank"
      rel="noopener"
      onClick={onClick}
    >
      {label}
    </a>
  );
}
