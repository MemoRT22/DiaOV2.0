import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchMyRafflePrizes, MIN_GAP_MS, nextDelay, verifiedForMs, type MyRafflePrize } from '../lib/raffleWinner';

/*
 * Un solo consultor de «mis premios» para toda la plataforma del alumno. No depende de Realtime ni guarda resultados en el
 * dispositivo: la fuente de verdad es Supabase y lo que se muestra vive solo en memoria.
 *
 * Carga: la cadencia la dicta el servidor (`poll_seconds`). Mientras se explora y se reserva, el servidor contesta «no consultes
 * periódicamente» (o un latido de 5 min si la persona ya participó); cuando hay un sorteo en curso y la persona está en una
 * categoría pregunta cada ~20 s, y cada ~15 s si tiene un resultado pendiente de entrega. Además consulta al abrir, al volver a la
 * pestaña/desbloquear y al recuperar la conexión (con un mínimo de 10 s entre consultas de este tipo).
 *
 * Verificado: lo que se muestra como reclamable solo vale si la última consulta salió bien y es reciente. Si la consulta falla, si
 * pasó demasiado tiempo o si se vuelve a la pantalla tras un rato, el resultado se marca «sin verificar» hasta confirmarlo.
 */

type PrizeState = {
  prizes: MyRafflePrize[];
  /** Ya hubo al menos una lectura completa (sin ella, «sin premio» no se distingue de «aún no sé»). */
  loaded: boolean;
  /** La última lectura salió bien y es reciente: solo entonces un premio pendiente puede presentarse como reclamable. */
  verified: boolean;
  refresh: () => Promise<void>;
};

const EMPTY: PrizeState = { prizes: [], loaded: false, verified: true, refresh: async () => undefined };
const Context = createContext<PrizeState>(EMPTY);

/** Fuera del proveedor (pantallas aisladas, pruebas) no hay premios: la Bitácora sigue funcionando con su mensaje de siempre. */
export const useRafflePrizes = () => useContext(Context);

/** Al volver a la pantalla tras más de esto, lo mostrado se considera sin verificar hasta que la consulta responda. */
const WAKE_STALE_MS = 30_000;

export function RafflePrizeProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [prizes, setPrizes] = useState<MyRafflePrize[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [verified, setVerified] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const failures = useRef(0);
  const hint = useRef<number | null | undefined>(undefined); // cadencia que dictó el servidor; undefined = aún no se sabe
  const alive = useRef(true);
  const timer = useRef(0);
  const expiry = useRef(0);
  const lastStart = useRef(0);
  const lastOk = useRef(0);

  const schedule = useCallback((refreshFn: () => Promise<void>) => {
    window.clearTimeout(timer.current);
    const delay = nextDelay(failures.current, hint.current);
    if (delay === null || !alive.current) return;
    timer.current = window.setTimeout(() => { if (document.visibilityState === 'visible') void refreshFn(); }, delay);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    // Nunca dos lecturas a la vez: quien llega durante una espera esa misma lectura.
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      lastStart.current = Date.now();
      try {
        const reading = await fetchMyRafflePrizes();
        if (!alive.current) return;
        failures.current = 0;
        hint.current = reading.pollSeconds;
        lastOk.current = Date.now();
        setPrizes((current) => (JSON.stringify(current) === JSON.stringify(reading.prizes) ? current : reading.prizes));
        setLoaded(true);
        setVerified(true);
        window.clearTimeout(expiry.current);
        expiry.current = window.setTimeout(() => setVerified(false), verifiedForMs(reading.pollSeconds));
      } catch {
        if (!alive.current) return;
        failures.current += 1;
        // Lo último que se supo se conserva, pero ya no se presenta como confirmado por el servidor.
        setVerified(false);
      } finally {
        inFlight.current = null;
        schedule(refresh);
      }
    })();
    inFlight.current = run;
    return run;
  }, [schedule]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    // Volver a la pantalla / recuperar el foco: si lo mostrado ya no es reciente se marca sin verificar y se consulta (con un mínimo entre consultas).
    const wake = (force: boolean) => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastOk.current > WAKE_STALE_MS) setVerified(false);
      if (force || Date.now() - lastStart.current >= MIN_GAP_MS) void refresh();
    };
    const onVisible = () => wake(false);
    const onFocus = () => wake(false);
    const onOnline = () => wake(true);
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      window.clearTimeout(expiry.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, refresh]);

  const value = useMemo(() => ({ prizes, loaded, verified, refresh }), [prizes, loaded, verified, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
