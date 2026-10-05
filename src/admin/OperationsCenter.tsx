import { Activity, AlertTriangle, CalendarClock, Clock, RefreshCw, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, LoadError, PageSkeleton } from '../components/ui';
import { formatTime } from '../lib/catalog';
import { fetchOperationsOverview, type OperationsOverview, type OperationsSession } from '../lib/operationsApi';
import {
  attendanceRate,
  attentionSignals,
  formatUpdatedAgo,
  hasAttention,
  isUpcomingSoon,
  reservationPercent,
  TEMPORAL_LABELS,
  TEMPORAL_TONES,
  temporalStatus,
  type TemporalStatus,
} from '../lib/operationsHelpers';
import { useTheme } from '../theme/ThemeProvider';

const REFRESH_MS = 20_000;

type FilterKey = 'todas' | 'atencion' | 'en_curso' | 'proximas' | 'terminadas' | 'canceladas';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'atencion', label: 'Atención' },
  { key: 'en_curso', label: 'En curso' },
  { key: 'proximas', label: 'Próximas' },
  { key: 'terminadas', label: 'Terminadas' },
  { key: 'canceladas', label: 'Canceladas' },
];

export default function OperationsCenter() {
  const { edition } = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('todas');
  const [divisionFilter, setDivisionFilter] = useState<string>('');
  const [, setLastFetch] = useState<number>(Date.now());
  const [agoLabel, setAgoLabel] = useState('Actualizado ahora');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationsOverview();
      setData(result);
      setError(null);
      setLastFetch(Date.now());
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  useEffect(() => {
    const update = () => {
      if (data?.server_time) setAgoLabel(formatUpdatedAgo(data.server_time));
    };
    update();
    agoTimerRef.current = setInterval(update, 1000);
    return () => {
      if (agoTimerRef.current) clearInterval(agoTimerRef.current);
    };
  }, [data?.server_time]);

  const isPrep = data?.mode === 'preparacion' || edition?.mode === 'preparacion';

  const divisions = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, { id: string; name: string }>();
    for (const s of data.sessions) {
      if (!seen.has(s.division_id)) seen.set(s.division_id, { id: s.division_id, name: s.division_name });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const serverTime = data ? new Date(data.server_time).getTime() : Date.now();
  const checkinClose = data?.checkin_close_after_minutes ?? 20;

  const processed = useMemo(() => {
    if (!data) return [];
    return data.sessions.map((s) => {
      const status = temporalStatus(s, serverTime);
      const signals = attentionSignals(s, status, serverTime, checkinClose);
      const attention = hasAttention(s, status, serverTime, checkinClose);
      return { session: s, status, signals, attention };
    });
  }, [data, serverTime, checkinClose]);

  const filtered = useMemo(() => {
    let result = processed;
    if (divisionFilter) result = result.filter((p) => p.session.division_id === divisionFilter);
    if (filter === 'atencion') result = result.filter((p) => p.attention);
    else if (filter !== 'todas') {
      const map: Record<FilterKey, TemporalStatus | null> = {
        en_curso: 'en_curso',
        proximas: 'proxima',
        terminadas: 'terminada',
        canceladas: 'cancelada',
        todas: null,
        atencion: null,
      };
      const target = map[filter];
      if (target) result = result.filter((p) => p.status === target);
    }
    return result;
  }, [processed, filter, divisionFilter]);

  const sorted = useMemo(() => {
    const priority: Record<TemporalStatus, number> = {
      en_curso: 0,
      proxima: 1,
      terminada: 2,
      cancelada: 3,
      oculta: 4,
    };
    return [...filtered].sort((a, b) => {
      if (a.attention !== b.attention) return a.attention ? -1 : 1;
      const pd = priority[a.status] - priority[b.status];
      if (pd !== 0) return pd;
      return new Date(a.session.starts_at).getTime() - new Date(b.session.starts_at).getTime();
    });
  }, [filtered]);

  if (loading && !data) return <PageSkeleton blocks={4} />;
  if (error || !data) return <LoadError error={error} onRetry={load} />;

  const s = data.summary;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Centro de Operación</h1>
          <p className="mt-1 text-sm text-ink-muted">{agoLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          {isPrep && <Badge tone="warning">MODO PRUEBA</Badge>}
          <Button variant="secondary" onClick={load} loading={loading}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Actualizar
          </Button>
        </div>
      </header>

      <SummaryGrid summary={s} />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
              filter === f.key ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        {divisions.length > 1 && (
          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            className="ml-auto h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-muted focus:border-secondary-400 focus:outline-none"
          >
            <option value="">Todas las divisiones</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {sorted.length === 0 ? (
        <Alert>No hay sesiones que coincidan con este filtro.</Alert>
      ) : (
        <div className="space-y-3">
          {sorted.map(({ session, status, signals }) => (
            <SessionCard
              key={session.session_id}
              session={session}
              status={status}
              signals={signals}
              onCheckin={() => navigate(`/coordinacion/checkin?session=${session.session_id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryGrid({ summary }: { summary: OperationsOverview['summary'] }) {
  const cards = [
    { label: 'Participantes', value: summary.participants_total, icon: Users },
    { label: 'Aceptaron aviso', value: summary.platform_consents, icon: Users },
    { label: 'Reservaciones vigentes', value: summary.active_reservations, icon: CalendarClock },
    { label: 'Con reservación', value: summary.participants_with_reservations, icon: Users },
    { label: 'Asistencias', value: summary.total_attendances, icon: Activity },
    { label: 'Con asistencia', value: summary.unique_attended_participants, icon: Activity },
    { label: 'Sesiones totales', value: summary.sessions_total, icon: CalendarClock },
    { label: 'Próximas', value: summary.sessions_upcoming, icon: Clock },
    { label: 'En curso', value: summary.sessions_in_progress, icon: Activity },
    { label: 'Terminadas', value: summary.sessions_ended, icon: Clock },
    { label: 'Canceladas', value: summary.sessions_cancelled, icon: AlertTriangle },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="card p-3">
          <div className="flex items-center gap-2">
            <c.icon className="h-4 w-4 text-ink-muted" aria-hidden />
            <p className="text-xs text-ink-muted">{c.label}</p>
          </div>
          <p className="mt-1 font-display text-2xl font-extrabold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function SessionCard({
  session,
  status,
  signals,
  onCheckin,
}: {
  session: OperationsSession;
  status: TemporalStatus;
  signals: { label: string; tone: 'error' | 'warning' | 'neutral' }[];
  onCheckin: () => void;
}) {
  const rate = attendanceRate(session);
  const pct = reservationPercent(session);
  const serverTime = Date.now();
  const soon = isUpcomingSoon(session, serverTime);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{session.division_name}</span>
            {session.is_demo && <Badge tone="neutral">Demo</Badge>}
          </div>
          <h3 className="mt-1 text-base font-extrabold">{session.title}</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {formatTime(session.starts_at)} — {formatTime(session.ends_at)}
            {session.location ? ` · ${session.location}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone={TEMPORAL_TONES[status]}>{TEMPORAL_LABELS[status]}</Badge>
          {signals.map((sig) => (
            <Badge key={sig.label} tone={sig.tone === 'neutral' ? 'neutral' : sig.tone}>{sig.label}</Badge>
          ))}
          {soon && status === 'proxima' && <Badge tone="info">Pronto</Badge>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Capacidad" value={session.capacity} />
        <Metric label="Reservados" value={session.reserved} />
        <Metric label="Disponibles" value={session.remaining} tone={session.remaining === 0 ? 'error' : session.remaining <= 3 ? 'warning' : undefined} />
        <Metric label="Asistencias" value={session.attended} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Reservación</span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-error-500' : pct >= 85 ? 'bg-warning-500' : 'bg-primary-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {status === 'terminada' && (
        <p className="mt-3 text-sm">
          {rate !== null ? (
            <>
              <span className="font-semibold">{session.reserved}</span> reservados ·{' '}
              <span className="font-semibold">{session.attended}</span> asistencias ·{' '}
              <span className="font-semibold text-success-300">Tasa de asistencia: {rate}%</span>
            </>
          ) : (
            <span className="text-ink-muted">Sin reservaciones</span>
          )}
        </p>
      )}

      {status === 'en_curso' && (
        <p className="mt-3 text-xs text-ink-muted">
          Reservaciones esperadas: <span className="font-semibold text-ink">{session.reserved}</span>
          {session.attended > 0 && (
            <span className="ml-3">
              Check-ins registrados: <span className="font-semibold text-ink">{session.attended}</span>
            </span>
          )}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onCheckin} className="min-h-9 px-4 text-xs">
          Abrir Check-in
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'error' | 'warning' }) {
  const color = tone === 'error' ? 'text-error-300' : tone === 'warning' ? 'text-warning-300' : 'text-ink';
  return (
    <div className="rounded-theme border border-line bg-surface-sunken px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-0.5 font-display text-lg font-extrabold ${color}`}>{value}</p>
    </div>
  );
}
