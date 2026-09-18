import type { ServerStatus } from "../hooks/useServerStatus";

/** Page states from ui-contract.md → Page states. */
export type PageStatus = "idle" | "resolving" | "loaded" | "downloading" | "url_error";

interface Props {
  serverStatus: ServerStatus;
}

export function HomePage({ serverStatus }: Props) {
  return (
    <main className="page">
      <header className="page__header">
        <h1>YouTube Clip Download</h1>
        <p className="lede">
          Paste a YouTube link, choose the part you want, and download just that segment — no
          account, no limits, nothing stored.
        </p>
      </header>
      <section aria-label="Video link" data-server-status={serverStatus} />
    </main>
  );
}
