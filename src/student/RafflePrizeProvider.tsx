import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchMyRafflePrizes, nextDelay, type MyRafflePrize } from '../lib/raffleWinner';

/*
 * Un solo consultor de «mis premios» para toda la plataforma del alumno. No depende de Realtime: pregunta al servidor al abrir,
 * cada ~20 s mientras la pantalla está visible, al volver a la pestaña y al recuperar la conexión. Si falla, conserva lo último
 * que sí supo y espera más antes de reintentar. Consultar nunca cambia el estado del premio en Supabase.
 */

type PrizeState = {
  prizes: MyRafflePrize[];
  /** Ya hubo al menos una lectura completa (sin ella, «sin premio» no se distingue de «aún no sé»). */
  loaded: boolean;
  /** La última lectura falló: lo que se muestra puede estar desactualizado. */
  stale: boolean;
  refresh: () => Promise<void>;
};

const EMPTY: PrizeState = { prizes: [], loaded: false, stale: false, refresh: async () => undefined };
const Context = createContext<PrizeState>(EMPTY);

/** Fuera del proveedor (pantallas aisladas, pruebas) no hay premios: la Bitácora sigue funcionando con su mensaje de siempre. */
export const useRafflePrizes = () => useContext(Context);

export function RafflePrizeProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [prizes, setPrizes] = useState<MyRafflePrize[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const failures = useRef(0);
  const alive = useRef(true);
  const timer = useRef(0);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    // Nunca dos lecturas a la vez: quien llega durante una espera esa misma lectura.
    if (inFlight.current) return inFlight.current;
    const mine = ++generation.current;
    const run = (async () => {
      try {
        const next = await fetchMyRafflePrizes();
        if (!alive.current || mine !== generation.current) return;
        failures.current = 0;
        setPrizes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        setLoaded(true);
        setStale(false);
      } catch {
        if (!alive.current) return;
        failures.current += 1;
        setStale(true);
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    const schedule = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await refresh();
        if (alive.current) schedule();
      }, nextDelay(failures.current));
    };
    const now = () => { if (document.visibilityState === 'visible') void refresh(); };
    void refresh();
    schedule();
    document.addEventListener('visibilitychange', now);
    window.addEventListener('online', now);
    window.addEventListener('focus', now);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', now);
      window.removeEventListener('online', now);
      window.removeEventListener('focus', now);
    };
  }, [enabled, refresh]);

  const value = useMemo(() => ({ prizes, loaded, stale, refresh }), [prizes, loaded, stale, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
