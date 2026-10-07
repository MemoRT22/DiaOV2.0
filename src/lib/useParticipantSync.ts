import { useEffect, useRef } from 'react';
import { subscribeParticipantChanges } from './participantSync';

const STALE_AFTER_HIDDEN_MS = 20_000;
const DEBOUNCE_MS = 250;

/**
 * Keeps a student screen fresh without polling:
 *  - another tab of the same browser announced a successful change → reload (coalesced);
 *  - this tab becomes visible again after being hidden for a significant time → reload once.
 * `reload` itself never announces anything, so this cannot loop. A quick tab flip (< 20 s) does nothing.
 */
export function useParticipantSync(reload: () => unknown, options: { staleAfterMs?: number; debounceMs?: number } = {}) {
  const { staleAfterMs = STALE_AFTER_HIDDEN_MS, debounceMs = DEBOUNCE_MS } = options;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    let timer = 0;
    let hiddenAt = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reloadRef.current(), debounceMs);
    };
    const unsubscribe = subscribeParticipantChanges(schedule);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > staleAfterMs) {
        hiddenAt = 0;
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [staleAfterMs, debounceMs]);
}
