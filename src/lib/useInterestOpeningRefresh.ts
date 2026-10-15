import { useEffect, useRef } from 'react';

const MAX_JITTER_MS = 30_000;
const CLOCK_SKEW_RETRY_MS = 60_000;
const MAX_RETRY_MS = 10 * 60_000;

/**
 * Wakes one server refresh when the configured general opening arrives. This is not polling: while the opening is in
 * the future there is one timer, distributed over 30 seconds to avoid a thundering herd. If the browser clock is ahead
 * of PostgreSQL and the server still says "not available", the next render schedules one spaced retry.
 */
export function useInterestOpeningRefresh(
  reload: () => unknown,
  options: { opensAt: string | null | undefined; available: boolean },
) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const jitterRef = useRef<number | undefined>(undefined);
  if (jitterRef.current === undefined) jitterRef.current = Math.floor(Math.random() * MAX_JITTER_MS);

  useEffect(() => {
    if (options.available || !options.opensAt) return;
    const opensAt = new Date(options.opensAt).getTime();
    if (!Number.isFinite(opensAt)) return;
    const untilOpening = opensAt - Date.now();
    let timer = 0;
    let retry = 0;
    const wake = () => {
      void reloadRef.current();
      // Normally the successful refresh flips `available` and the effect cleanup cancels this fallback. It remains armed
      // only for clock skew or a failed request, with exponential backoff capped at ten minutes.
      const backoff = Math.min(CLOCK_SKEW_RETRY_MS * (2 ** retry), MAX_RETRY_MS);
      retry += 1;
      timer = window.setTimeout(wake, backoff + jitterRef.current!);
    };
    const firstDelay = Math.max(untilOpening, untilOpening <= 0 ? CLOCK_SKEW_RETRY_MS : 0) + jitterRef.current!;
    timer = window.setTimeout(wake, firstDelay);
    return () => window.clearTimeout(timer);
  }, [options.available, options.opensAt]);
}
