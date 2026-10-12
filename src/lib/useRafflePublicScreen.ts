import { useCallback, useEffect, useRef, useState } from 'react';
import { openPublicChannel, PUBLIC_PATH, PUBLIC_WINDOW, type PublicChannel, type PublicState } from './rafflePublic';

const STALE_AFTER_MS = 8000;

/**
 * Console side of the public screen: keeps the window in step with the console, answers it when it (re)opens and
 * reports whether it is there. The window pings every few seconds, so a closed window is noticed.
 */
export function useRafflePublicScreen(state: PublicState) {
  const [connected, setConnected] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const channel = useRef<PublicChannel | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const lastSeen = useRef(0);
  const supported = typeof BroadcastChannel !== 'undefined';

  useEffect(() => {
    const seen = () => { lastSeen.current = Date.now(); setConnected(true); setBlocked(false); };
    const opened = openPublicChannel((message) => {
      if (message.type === 'hello') { seen(); channel.current?.post({ type: 'state', state: latest.current }); }
      else if (message.type === 'ping') seen();
      else if (message.type === 'bye') { lastSeen.current = 0; setConnected(false); }
    });
    channel.current = opened;
    opened?.post({ type: 'state', state: latest.current });
    const timer = setInterval(() => { if (lastSeen.current && Date.now() - lastSeen.current > STALE_AFTER_MS) { lastSeen.current = 0; setConnected(false); } }, 2000);
    return () => {
      clearInterval(timer);
      // Leaving the console (another section, another environment) returns the public screen to its title.
      opened?.post({ type: 'state', state: null });
      opened?.close();
      channel.current = null;
    };
  }, []);

  useEffect(() => { channel.current?.post({ type: 'state', state }); }, [state]);

  /** Opens (or brings forward) the public window. False when the browser blocked it. */
  const open = useCallback(() => {
    const opened = window.open(PUBLIC_PATH, PUBLIC_WINDOW, 'popup,width=1280,height=720');
    setBlocked(!opened);
    opened?.focus?.();
    return !!opened;
  }, []);

  return { supported, connected, blocked, open };
}
