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

/**
 * Aviso de saturación o falta de conexión. Si el servidor indicó cuánto esperar (`Retry-After`) se respeta con una cuenta atrás
 * sencilla; el botón nunca queda bloqueado más allá de ese tiempo.
 */
export default function AccessNotice({ saturation, busy, onRetry, note }: { saturation: Saturation; busy: boolean; onRetry: () => void; note?: string }) {
  const [remaining, setRemaining] = useState(saturation.waitSeconds);
  useEffect(() => {
    setRemaining(saturation.waitSeconds);
    if (saturation.waitSeconds <= 0) return;
    const timer = setInterval(() => setRemaining((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [saturation]);
  const copy = COPY[saturation.code];
  return (
    <div role="alert" className="space-y-3 rounded-theme border border-warning-500/40 bg-warning-500/10 p-4 text-sm">
      <p className="font-extrabold">{copy.title}</p>
      <p>{copy.body}</p>
      {note && <p className="text-ink-muted">{note}</p>}
      {remaining > 0 && <p className="text-ink-muted" aria-live="polite">Puedes volver a intentar en {remaining} {remaining === 1 ? 'segundo' : 'segundos'}.</p>}
      <Button type="button" variant="secondary" className="w-full" disabled={remaining > 0} loading={busy} onClick={onRetry}>Volver a intentar</Button>
    </div>
  );
}
