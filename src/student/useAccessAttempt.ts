import { useCallback, useEffect, useRef, useState } from 'react';
import { retryAfterOf, temporaryCodeOf, type TemporaryCode } from '../lib/accessErrors';
import { friendlyError } from '../lib/errors';

/** Lo que la pantalla muestra cuando el acceso está saturado o sin conexión: nunca un error de datos ni de contraseña. */
export type Saturation = { code: TemporaryCode; waitSeconds: number };

/** Espera por omisión (con variación aleatoria) cuando el servidor no dijo cuánto: así los teléfonos no vuelven a la vez. */
export function defaultWait(code: TemporaryCode, retryAfterSeconds?: number, random: () => number = Math.random): number {
  if (retryAfterSeconds !== undefined) return retryAfterSeconds;
  if (code === 'RATE_LIMITED') return 8 + Math.floor(random() * 8);
  if (code === 'TEMPORARILY_UNAVAILABLE') return 5 + Math.floor(random() * 6);
  // Un tiempo agotado es señal de saturación: una breve espera (con variación) evita que cientos de teléfonos reintenten a la vez.
  if (code === 'TIMEOUT') return 4 + Math.floor(random() * 5);
  return 0;
}

/**
 * Un envío a la vez por formulario: ignora clics repetidos mientras hay uno en curso, cancela lo que siga en segundo plano si la
 * persona abandona la pantalla, y separa los errores definitivos (se muestran) de los temporales (aviso con «Volver a intentar»).
 * Los campos, el correo y el paso viven en el componente, así que nada de eso se pierde al fallar.
 */
export function useAccessAttempt() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saturation, setSaturation] = useState<Saturation | null>(null);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const last = useRef<((signal: AbortSignal) => Promise<void>) | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    last.current = task;
    const mine = new AbortController();
    controller.current = mine;
    setError('');
    setSaturation(null);
    setBusy(true);
    try {
      await task(mine.signal);
    } catch (cause) {
      if (mine.signal.aborted || (cause instanceof Error && cause.message === 'ABORTED')) return;
      const code = temporaryCodeOf(cause);
      if (code) setSaturation({ code, waitSeconds: defaultWait(code, retryAfterOf(cause)) });
      else setError(friendlyError(cause));
    } finally {
      running.current = false;
      if (!mine.signal.aborted) setBusy(false);
    }
  }, []);

  /** «Volver a intentar»: repite exactamente el último envío. */
  const retry = useCallback(() => (last.current ? run(last.current) : Promise.resolve()), [run]);
  return { busy, error, setError, saturation, run, retry };
}
