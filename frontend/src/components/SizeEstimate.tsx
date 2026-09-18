import { copy } from "../copy";
import { largeDownloadThreshold } from "../lib/estimate";
import { formatBytes } from "../lib/format";

export function SizeEstimate({ bytes }: { bytes: number }) {
  const large = bytes >= largeDownloadThreshold();
  return (
    <div className="size-estimate">
      <p className="note" data-testid="size-estimate">
        Estimated size {copy.size_estimate(formatBytes(bytes))}
      </p>
      {large && (
        <p className="note note--warn" role="note">
          {copy.large_download_note}
        </p>
      )}
    </div>
  );
}
