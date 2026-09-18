import { useEffect, useRef } from "react";

import type { VideoInfo } from "../api/client";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { toHms } from "../lib/format";

interface Props {
  video: VideoInfo;
  startS: number;
  endS: number;
}

const SEEK_DEBOUNCE_MS = 200;

/** In-page preview of exactly the selected segment; hidden when YouTube forbids embedding. */
export function PreviewPlayer({ video, startS, endS }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const player = useYouTubePlayer(video.embeddable ? video.video_id : null, host);

  // Follow the start handle while it is dragged, without flooding the player with seeks.
  useEffect(() => {
    if (!player.ready) return;
    const timer = setTimeout(() => player.seekTo(startS), SEEK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [startS, player]);

  if (!video.embeddable) return null;

  return (
    <div className="preview">
      <div className="preview__frame" ref={host} />
      <div className="row preview__controls">
        <button
          type="button"
          className="button"
          disabled={!player.ready}
          onClick={() => player.playRange(startS, endS)}
        >
          Preview selection ({toHms(startS)} – {toHms(endS)})
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!player.ready}
          onClick={player.toggleMute}
          aria-pressed={!player.muted}
        >
          {player.muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}
