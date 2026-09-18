import { copy } from "../copy";

interface Props {
  onAnother: () => void;
}

export function DownloadHint({ onAnother }: Props) {
  return (
    <div className="card card--hint" role="status">
      <p>{copy.download_hint}</p>
      <p className="note">{copy.download_failed_hint}</p>
      <button type="button" className="button" onClick={onAnother}>
        Make another clip
      </button>
    </div>
  );
}
