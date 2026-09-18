import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API = "https://www.youtube.com/iframe_api";
const POLL_MS = 250;

let apiPromise: Promise<void> | null = null;

/** Loads the IFrame Player API once per page; never resolves in environments without network. */
function loadIframeApi(): Promise<void> {
  if (typeof window === "undefined") return new Promise(() => {});
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolveApi) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolveApi();
    };
    if (!document.querySelector(`script[src="${IFRAME_API}"]`)) {
      const script = document.createElement("script");
      script.src = IFRAME_API;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

export interface YouTubePlayerControls {
  ready: boolean;
  muted: boolean;
  seekTo: (seconds: number) => void;
  /** Seek to `start`, play, and pause once playback reaches `end` (US3 scenario 3). */
  playRange: (startS: number, endS: number) => void;
  pause: () => void;
  toggleMute: () => void;
}

export function useYouTubePlayer(
  videoId: string | null,
  container: RefObject<HTMLDivElement | null>,
): YouTubePlayerControls {
  const player = useRef<YT.Player | null>(null);
  const stopTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);

  const clearTimer = () => {
    if (stopTimer.current) {
      clearInterval(stopTimer.current);
      stopTimer.current = null;
    }
  };

  useEffect(() => {
    if (!videoId || !container.current) return;
    let cancelled = false;
    const host = container.current;
    setReady(false);

    loadIframeApi().then(() => {
      if (cancelled || !host.isConnected || !window.YT?.Player) return;
      // The API replaces the element it is given, so mount on a child to keep our ref intact.
      const mount = document.createElement("div");
      host.replaceChildren(mount);
      player.current = new window.YT.Player(mount, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { controls: 1, rel: 0, playsinline: 1, mute: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            if (cancelled) return;
            player.current?.mute();
            setMuted(true);
            setReady(true);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      clearTimer();
      player.current?.destroy();
      player.current = null;
      host.replaceChildren();
      setReady(false);
    };
  }, [videoId, container]);

  const seekTo = useCallback((seconds: number) => {
    clearTimer();
    player.current?.seekTo(seconds, true);
    player.current?.pauseVideo();
  }, []);

  const playRange = useCallback((startS: number, endS: number) => {
    const p = player.current;
    if (!p) return;
    clearTimer();
    p.seekTo(startS, true);
    p.playVideo();
    stopTimer.current = setInterval(() => {
      if (p.getCurrentTime() >= endS) {
        p.pauseVideo();
        clearTimer();
      }
    }, POLL_MS);
  }, []);

  const pause = useCallback(() => {
    clearTimer();
    player.current?.pauseVideo();
  }, []);

  const toggleMute = useCallback(() => {
    const p = player.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  }, []);

  return { ready, muted, seekTo, playRange, pause, toggleMute };
}
