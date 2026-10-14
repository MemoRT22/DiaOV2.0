import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import type { Saturation } from './useAccessAttempt';

const COPY: Record<Saturation['code'], { title: string; body: string }> = {
  RATE_LIMITED: {
    title: 'Estamos recibiendo muchas solicitudes',
    body: 'Hay varios alumnos entrando a la plataforma al mismo tiempo. Tu información se conserva. Intenta nuevamente en unos momentos.',
  },
  TEMPORARILY_UNAVAILABLE: {
    title: 'Estamos recibiendo muchas solicitudes',
    body: 'Hay varios alumnos entrando a la plataforma al mismo tiempo. Tu información se conserva. Intenta nuevamente en unos momentos.',
  },
  NETWORK: { title: 'No pudimos conectarnos', body: 'Revisa tu conexión a internet. Tu información se conserva.' },
  TIMEOUT: { title: 'La conexión tardó demasiado', body: 'Tu información se conserva. Intenta nuevamente.' },
};

/** «45 segundos», «1 minuto 5 segundos», «6 minutos». */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const head = `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  return rest === 0 ? head : `${head} ${rest} ${rest === 1 ? 'segundo' : 'segundos'}`;
}

/**
 * Aviso de saturación o falta de conexión. Si el servidor indicó cuánto esperar (`Retry-After`) se respeta con una cuenta atrás
 * sencilla —aunque sean varios minutos— y el botón nunca queda bloqueado más allá de ese tiempo. La cuenta atrás se calcula contra
 * el reloj (no restando de segundo en segundo), para que una pestaña en segundo plano no se atrase y anime a reintentar antes de tiempo.
 */
export default function AccessNotice({ saturation, busy, onRetry, note }: { saturation: Saturation; busy: boolean; onRetry: () => void; note?: string }) {
  const [remaining, setRemaining] = useState(saturation.waitSeconds);
  useEffect(() => {
    if (saturation.waitSeconds <= 0) { setRemaining(0); return; }
    const deadline = Date.now() + saturation.waitSeconds * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [saturation]);
  const copy = COPY[saturation.code];
  return (
    <div role="alert" className="space-y-3 rounded-theme border border-warning-500/40 bg-warning-500/10 p-4 text-sm">
      <p className="font-extrabold">{copy.title}</p>
      <p>{copy.body}</p>
      {note && <p className="text-ink-muted">{note}</p>}
      {saturation.waitSeconds > 60 && remaining > 0 && <p className="text-ink-muted">La plataforma pidió esperar un poco más de lo normal. Puedes dejar esta página abierta: lo que escribiste se conserva mientras no la cierres.</p>}
      {remaining > 0 && <p className="text-ink-muted" aria-live="polite">Puedes volver a intentar en {formatWait(remaining)}.</p>}
      <Button type="button" variant="secondary" className="w-full" disabled={remaining > 0} loading={busy} onClick={onRetry}>Volver a intentar</Button>
    </div>
  );
}
