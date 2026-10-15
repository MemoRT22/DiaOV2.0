import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchParticipantsSummary, type ParticipantsSummary } from '../../lib/participantOrientation';

const REFRESH_MS = 60_000;

function Stat({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'warn' }) {
  return (
    <div className={`ad-stat ${tone === 'warn' ? 'ad-stat-warn' : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** One glance at how the day is going and how many students could be confused by several accounts. Refreshes by itself every minute. */
export default function ParticipantsDashboard() {
  const [data, setData] = useState<ParticipantsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchParticipantsSummary();
      if (next && typeof next.accounts_total === 'number') { setData(next); setFailed(false); } else setFailed(true);
    } catch { setFailed(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!data) return failed ? <p className="ad-context-help" role="status">No se pudo cargar el resumen. <button type="button" className="underline" onClick={() => void load()}>Reintentar</button></p> : null;
  return (
    <section className="ad-dashboard" aria-label="Resumen de participantes">
      <div className="ad-dashboard-grid">
        <Stat label="Cuentas" value={data.accounts_total} hint={`${data.accounts_with_login} ya crearon acceso`} />
        <Stat label="Con sesión reciente" value={data.active_last_hour} hint="última hora" />
        <Stat label="Con reservaciones" value={data.with_reservations} hint={`${data.reservations_active} vigentes`} />
        <Stat label="Con asistencia" value={data.with_attendance} hint={`${data.stamps_total} sellos`} />
        <Stat label="Posibles duplicados" value={data.duplicate_groups} hint={`${data.duplicate_accounts} cuentas · mismo teléfono`} tone={data.duplicate_groups > 0 ? 'warn' : undefined} />
        <Stat label="Su ruta está en otra cuenta" value={data.duplicates_route_elsewhere} hint="la última cuenta usada está vacía" tone={data.duplicates_route_elsewhere > 0 ? 'warn' : undefined} />
      </div>
      <p className="ad-dashboard-foot">
        Actualizado {new Date(data.server_time).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cancun' })} (Cancún)
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="Actualizar resumen"><RefreshCw size={13} aria-hidden className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </p>
    </section>
  );
}
