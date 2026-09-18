import { useCallback, useEffect, useState } from "react";

import { health } from "../api/client";

export type ServerStatus = "booting" | "waking" | "ready" | "down";

const WAKING_AFTER_MS = 3_000;

/**
 * Pings /api/health on mount. A free-tier instance sleeps when idle and takes up to a minute to
 * wake, so after 3 s without an answer the status becomes "waking" (research R10).
 */
export function useServerStatus(): { status: ServerStatus; retry: () => void } {
  const [status, setStatus] = useState<ServerStatus>("booting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus("booting");
    const wakingTimer = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "booting" ? "waking" : current));
    }, WAKING_AFTER_MS);

    health(controller.signal)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("down");
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(wakingTimer);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, retry };
}
