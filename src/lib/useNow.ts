import { useEffect, useState } from 'react';

/** Current time that re-renders every `everyMs` (default 30 s) — enough for «Empieza en 12 min» without polling the server. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
