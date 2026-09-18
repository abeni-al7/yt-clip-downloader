import { copy } from "../copy";
import type { ServerStatus } from "../hooks/useServerStatus";

interface Props {
  status: ServerStatus;
  onRetry: () => void;
}

export function ServerStatusBanner({ status, onRetry }: Props) {
  if (status === "ready" || status === "booting") return null;
  const down = status === "down";
  return (
    <div className={`banner ${down ? "banner--down" : "banner--waking"}`} role="status">
      <span>{down ? copy.server_down : copy.server_waking}</span>
      {down && (
        <button type="button" className="button button--small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
