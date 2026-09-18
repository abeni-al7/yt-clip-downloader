import { useCallback, useState } from "react";

import { ApiError, type OutputFormat, type VideoInfo, clipUrl, resolve } from "../api/client";
import { BoundaryNotice } from "../components/BoundaryNotice";
import { DownloadButton } from "../components/DownloadButton";
import { DownloadHint } from "../components/DownloadHint";
import { FormatPicker } from "../components/FormatPicker";
import { PreviewPlayer } from "../components/PreviewPlayer";
import { type Range, RangeSelector } from "../components/RangeSelector";
import { SizeEstimate } from "../components/SizeEstimate";
import { TimestampField } from "../components/TimestampField";
import { UrlInput } from "../components/UrlInput";
import { VideoCard } from "../components/VideoCard";
import { copy } from "../copy";
import type { ServerStatus } from "../hooks/useServerStatus";
import { estimateForSelection } from "../lib/estimate";
import { toHms } from "../lib/format";

/** Page states from ui-contract.md → Page states. */
export type PageStatus = "idle" | "resolving" | "loaded" | "url_error";

export interface Selection {
  startS: number;
  endS: number;
  format: OutputFormat;
  height: number | null;
}

interface PageState {
  status: PageStatus;
  video: VideoInfo | null;
  selection: Selection;
  error: string | null;
  startNote: string | null;
  endNote: string | null;
  downloaded: boolean;
}

const INITIAL: PageState = {
  status: "idle",
  video: null,
  selection: { startS: 0, endS: 0, format: "mp4", height: null },
  error: null,
  startNote: null,
  endNote: null,
  downloaded: false,
};

const RETRYABLE = new Set(["bot_check", "extraction_failed", "network", "timeout"]);

export function isVideoFormat(format: OutputFormat): format is "mp4" | "webm" {
  return format === "mp4" || format === "webm";
}

export function defaultHeight(video: VideoInfo, format: OutputFormat): number | null {
  if (!isVideoFormat(format)) return null;
  return video.resolutions[format][0]?.height ?? null;
}

function defaultSelection(video: VideoInfo): Selection {
  const start = Math.min(Math.max(0, video.start_hint_s ?? 0), Math.max(0, video.duration_s - 1));
  return {
    startS: start,
    endS: video.duration_s,
    format: "mp4",
    height: defaultHeight(video, "mp4"),
  };
}

interface Props {
  serverStatus: ServerStatus;
}

export function HomePage({ serverStatus }: Props) {
  const [state, setState] = useState<PageState>(INITIAL);
  const { video, selection } = state;

  const loadVideo = useCallback(async (url: string) => {
    setState((s) => ({ ...s, status: "resolving", error: null, downloaded: false }));
    try {
      const info = await resolve(url);
      setState({ ...INITIAL, status: "loaded", video: info, selection: defaultSelection(info) });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const message = apiError?.message ?? "Something went wrong while loading the video.";
      const suffix = apiError && RETRYABLE.has(apiError.code) ? ` ${copy.try_again_suffix}` : "";
      setState((s) => ({ ...s, status: "url_error", video: null, error: message + suffix }));
    }
  }, []);

  const update = (
    patch: Partial<Selection>,
    notes: Partial<Pick<PageState, "startNote" | "endNote">> = {},
  ) =>
    setState((s) => ({
      ...s,
      selection: { ...s.selection, ...patch },
      startNote: null,
      endNote: null,
      ...notes,
      downloaded: false,
    }));

  const onStartChange = (seconds: number) => {
    if (!video) return;
    const max = Math.max(0, video.duration_s - 1);
    if (seconds < 0) return update({ startS: 0 }, { startNote: copy.start_clamped });
    update({ startS: Math.min(seconds, max) });
  };

  const onEndChange = (seconds: number) => {
    if (!video) return;
    if (seconds > video.duration_s) {
      return update(
        { endS: video.duration_s },
        { endNote: copy.end_clamped(toHms(video.duration_s)) },
      );
    }
    update({ endS: Math.max(0, seconds) });
  };

  const onFormatChange = (format: OutputFormat) => {
    if (!video) return;
    update({ format, height: defaultHeight(video, format) });
  };

  const onRangeChange = (range: Range) => update({ startS: range.startS, endS: range.endS });

  const rangeError = video && selection.endS - selection.startS < 1 ? copy.end_before_start : null;
  const needsHeight = isVideoFormat(selection.format) && selection.height === null;

  let disabledReason: string | null = null;
  if (serverStatus !== "ready") disabledReason = copy.server_waking;
  else if (rangeError) disabledReason = rangeError;
  else if (needsHeight) disabledReason = copy.no_webm;

  const href =
    video && !disabledReason
      ? clipUrl({
          v: video.video_id,
          start: selection.startS,
          end: selection.endS,
          format: selection.format,
          height: selection.height,
        })
      : null;

  return (
    <main className="page">
      <header className="page__header">
        <h1>YouTube Clip Download</h1>
        <p className="lede">
          Paste a YouTube link, choose the part you want, and download just that segment — no
          account, no limits, nothing stored.
        </p>
      </header>

      <UrlInput
        disabled={serverStatus === "down"}
        busy={state.status === "resolving"}
        serverError={state.status === "url_error" ? state.error : null}
        onSubmit={loadVideo}
      />

      {video && state.status === "loaded" && (
        <>
          <section className="card" aria-label="Video">
            <VideoCard video={video} />
          </section>

          <section className="card" aria-label="Time range">
            <PreviewPlayer video={video} startS={selection.startS} endS={selection.endS} />
            <RangeSelector
              durationS={video.duration_s}
              startS={selection.startS}
              endS={Math.max(selection.startS + 1, selection.endS)}
              onChange={onRangeChange}
            />
            <div className="row">
              <TimestampField
                id="start"
                label="Start"
                valueS={selection.startS}
                onChange={onStartChange}
                note={state.startNote}
              />
              <TimestampField
                id="end"
                label="End"
                valueS={selection.endS}
                onChange={onEndChange}
                error={rangeError}
                note={state.endNote}
              />
            </div>
            <BoundaryNotice />
          </section>

          <section className="card" aria-label="Format and quality">
            <FormatPicker video={video} value={selection.format} onChange={onFormatChange} />
          </section>

          <section className="card" aria-label="Download">
            <SizeEstimate
              bytes={estimateForSelection({
                video,
                format: selection.format,
                height: selection.height,
                startS: selection.startS,
                endS: Math.max(selection.startS, selection.endS),
              })}
            />
            <DownloadButton
              href={href}
              durationS={Math.max(0, selection.endS - selection.startS)}
              disabledReason={disabledReason}
              onClick={() => setState((s) => ({ ...s, downloaded: true }))}
            />
            {disabledReason && !rangeError && <p className="note">{disabledReason}</p>}
          </section>

          {state.downloaded && (
            <DownloadHint
              onAnother={() =>
                setState((s) => ({ ...s, downloaded: false, selection: defaultSelection(video) }))
              }
            />
          )}
        </>
      )}
    </main>
  );
}
