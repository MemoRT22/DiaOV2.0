import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { claimExitSurveyInvitation, fetchMyExitSurvey, nextCheckDelay, type ExitSurveyStatus } from '../lib/exitSurvey';
import { subscribeParticipantChanges } from '../lib/participantSync';
import { MIN_GAP_MS } from '../lib/raffleWinner';

/*
 * Un solo lector del estado de la encuesta de salida para toda la plataforma del alumno. La fuente de verdad es el servidor
 * (hora de apertura, si ya contestó, elegibilidad); aquí solo vive en memoria.
 *
 * No depende de un temporizador del navegador: el temporizador solo despierta la consulta a la hora indicada por el servidor (con
 * la diferencia de reloj ya corregida y una variación aleatoria de hasta 30 s para que no pregunten todos a la vez). Además se
 * consulta al abrir la aplicación, al volver a la pestaña, al recuperar el foco o la conexión y al registrar una asistencia. Quien
 * abre la aplicación después de la hora ve la encuesta disponible en la primera lectura. Si la lectura falla se reintenta con
 * espera creciente; una vez contestada, no se vuelve a consultar.
 */

type ExitSurveyState = {
  /** `false` fuera del proveedor o sin Aviso de Privacidad aceptado. */
  enabled: boolean;
  status: ExitSurveyStatus | null;
  /** Ya hubo al menos una lectura (sin ella «no contestada» no se distingue de «aún no sé»). */
  loaded: boolean;
  /** La última lectura falló y todavía no hay una buena. */
  failed: boolean;
  refresh: () => Promise<void>;
  /** Aplica un estado que el servidor acaba de devolver (p. ej. el del envío), sin otra consulta. */
  apply: (status: ExitSurveyStatus) => void;
  /**
   * Reclama el derecho a mostrar la invitación automática (atómico en el servidor): `claimed` = este dispositivo lo obtuvo y puede abrir
   * el popup; `taken` = otro dispositivo/pestaña ya lo tiene (o ya contestó); `failed` = no se pudo confirmar (conexión): no se abre.
   */
  claimInvitation: () => Promise<'claimed' | 'taken' | 'failed'>;
};

const NOOP: ExitSurveyState = { enabled: false, status: null, loaded: false, failed: false, refresh: async () => undefined, apply: () => undefined, claimInvitation: async () => 'failed' };
const Context = createContext<ExitSurveyState>(NOOP);

/** Fuera del proveedor (pantallas aisladas, pruebas) no hay encuesta: la Bitácora funciona como siempre. */
export const useExitSurvey = () => useContext(Context);

export function ExitSurveyProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [status, setStatus] = useState<ExitSurveyStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);
  const failures = useRef(0);
  const timer = useRef(0);
  const lastStart = useRef(0);
  const current = useRef<ExitSurveyStatus | null>(null);

  const arm = useCallback((refreshFn: () => Promise<void>) => {
    window.clearTimeout(timer.current);
    if (!alive.current) return;
    const delay = nextCheckDelay(current.current, failures.current);
    if (delay === null) return;
    timer.current = window.setTimeout(() => { if (document.visibilityState === 'visible') void refreshFn(); else arm(refreshFn); }, delay);
  }, []);

  const apply = useCallback((next: ExitSurveyStatus) => {
    current.current = next;
    setStatus((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    setLoaded(true);
    setFailed(false);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current; // nunca dos lecturas a la vez
    const run = (async () => {
      lastStart.current = Date.now();
      try {
        const next = await fetchMyExitSurvey();
        if (!alive.current) return;
        failures.current = 0;
        apply(next);
      } catch {
        if (!alive.current) return;
        failures.current += 1;
        setFailed(current.current === null);
      } finally {
        inFlight.current = null;
        arm(refresh);
      }
    })();
    inFlight.current = run;
    return run;
  }, [apply, arm]);

  const claimInvitation = useCallback(async (): Promise<'claimed' | 'taken' | 'failed'> => {
    try {
      const { status: next, claimed } = await claimExitSurveyInvitation();
      if (alive.current) apply(next);
      return claimed ? 'claimed' : 'taken';
    } catch {
      return 'failed'; // sin confirmación del servidor no se sabe si este dispositivo obtuvo el derecho: no se abre nada
    }
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    const wake = (force: boolean) => {
      if (document.visibilityState !== 'visible' || current.current?.completed) return;
      if (force || Date.now() - lastStart.current >= MIN_GAP_MS) void refresh();
    };
    const onVisible = () => wake(false);
    const onFocus = () => wake(false);
    const onOnline = () => wake(true);
    // Un sello nuevo cambia si ya alcanza una categoría: se pone al día lo que dice la Bitácora.
    const unsubscribe = subscribeParticipantChanges((kind) => { if (kind === 'attendance') wake(true); });
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, refresh]);

  const value = useMemo(() => ({ enabled, status, loaded, failed, refresh, apply, claimInvitation }), [enabled, status, loaded, failed, refresh, apply, claimInvitation]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
