import { CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, LoadError, PageSkeleton } from '../components/ui';
import { formatTime } from '../lib/catalog';
import { fetchOperationsOverview, type OperationsOverview } from '../lib/operationsApi';
import {
  applyFilters, buildRows, defaultView, divisionOptions, eventPhase, formatSpan, formatUpdatedAgo, minutesUntilStart,
  NO_FILTERS, SOON_MINUTES, splitViews, unlocatedUpcoming, type Filters, type OperationsView, type Row,
} from '../lib/operationsHelpers';
import SessionRow from './operations/SessionRow';
import SessionTable from './operations/SessionTable';
import ProgramPulse from './operations/ProgramPulse';
import SummaryStrip, { summaryItems } from './operations/SummaryStrip';

const REFRESH_MS = 20_000;
const TICK_MS = 15_000;

const VIEWS: { key: OperationsView; label: string }[] = [
  { key: 'ahora', label: 'Ahora' },
  { key: 'proximas', label: 'Próximas' },
  { key: 'atencion', label: 'Atención' },
  { key: 'programa', label: 'Programa completo' },
];

const MOMENTS: { value: Filters['moment']; label: string }[] = [
  { value: '', label: 'Todos los momentos' },
  { value: 'en_curso', label: 'En curso' },
  { value: 'proxima', label: 'Próximas' },
  { value: 'terminada', label: 'Terminadas' },
  { value: 'cancelada', label: 'Canceladas' },
  { value: 'oculta', label: 'Ocultas' },
];

const selectClass =
  'h-10 rounded-theme border border-line bg-surface px-3 text-sm text-ink focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30';

export default function OperationsCenter() {
  const [data, setData] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<OperationsView | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // The browser clock is only used to measure elapsed time since the snapshot; the base is the server's clock.
  const fetchedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationsOverview();
      fetchedAt.current = Date.now();
      setData(result);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  const elapsed = Date.now() - fetchedAt.current;
  const now = data ? new Date(data.server_time).getTime() + elapsed : 0;
  const rows = useMemo(() => (data ? buildRows(data, now) : []), [data, now]);
  const phase = data ? eventPhase(data, rows, now) : 'pre';
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const views = useMemo(() => splitViews(filtered, now), [filtered, now]);
  const divisions = useMemo(() => (data ? divisionOptions(data.sessions) : []), [data]);

  if (loading && !data) return <PageSkeleton blocks={4} />;
  if (error && !data) return <LoadError error={error} onRetry={load} />;
  if (!data) return <LoadError error={error} onRetry={load} />;

  const active = view ?? defaultView(phase);
  const allViews = splitViews(rows, now);
  const attentionCount = allViews.atencion.length;
  const counts = {
    inProgress: rows.filter((r) => r.status === 'en_curso').length,
    upcoming: rows.filter((r) => r.status === 'proxima').length,
    attention: attentionCount,
    scheduledSessions: rows.filter((r) => r.status !== 'cancelada' && r.status !== 'oculta').length,
  };
  const tz = data.timezone;
  const searching = filters.query.trim() !== '' || filters.divisionId !== '';
  const unlocated = unlocatedUpcoming(rows);
  const real = data.mode === 'operacion_real';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold">Centro de Operación</h1>
            <Badge tone={real ? 'success' : 'warning'}>{real ? 'Operación real' : 'Preparación'}</Badge>
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-ink-muted">
            <span aria-hidden className={`admin-pulse h-2 w-2 rounded-full ${error ? 'bg-amber-500 text-amber-500' : 'bg-emerald-500 text-emerald-500'}`} />
            {formatUpdatedAgo(elapsed)}
          </p>
        </div>
        <Button variant="secondary" onClick={load} loading={loading} className="min-h-10">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Actualizar
        </Button>
      </header>

      {!!error && <Alert tone="warning">No se pudo actualizar; se muestran los últimos datos recibidos.</Alert>}

      <ProgramPulse summary={data.summary} />
      <SummaryStrip items={summaryItems(phase, data.summary, counts)} />

      <div className="card space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Buscar taller, lugar o división</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder="Buscar taller, lugar o división"
            className="field-input h-11 w-full rounded-xl border border-line bg-surface-raised pl-10 pr-3 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none"
          />
        </label>
        {divisions.length > 1 && (
          <label>
            <span className="sr-only">División</span>
            <select value={filters.divisionId} onChange={(e) => setFilters({ ...filters, divisionId: e.target.value })} className={selectClass}>
              <option value="">Todas las divisiones</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div role="tablist" aria-label="Vistas del Centro de Operación" className="no-scrollbar flex max-w-full gap-1 self-start overflow-x-auto rounded-xl bg-neutral-500/10 p-1 [width:fit-content]">
        {VIEWS.map(({ key, label }) => {
          const selected = active === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={selected}
              onClick={() => setView(key)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none ${
                selected ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label}
              {key === 'atencion' && attentionCount > 0 && (
                <span className="rounded-full bg-warning-500/20 px-2 py-0.5 text-xs font-bold text-fg-warning" aria-label={`${attentionCount} por atender`}>
                  {attentionCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {active === 'programa' && (
        <div className="flex flex-wrap gap-2">
          <label>
            <span className="sr-only">Momento</span>
            <select value={filters.moment} onChange={(e) => setFilters({ ...filters, moment: e.target.value as Filters['moment'] })} className={selectClass}>
              {MOMENTS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Lugares</span>
            <select value={filters.demand} onChange={(e) => setFilters({ ...filters, demand: e.target.value as Filters['demand'] })} className={selectClass}>
              <option value="">Todos los cupos</option>
              <option value="con_lugares">Con lugares</option>
              <option value="llenas">Llenas</option>
            </select>
          </label>
        </div>
      )}
      </div>

      {unlocated.length > 0 && active !== 'atencion' && (
        <Alert tone="info">
          {unlocated.length} {unlocated.length === 1 ? 'sesión próxima sin ubicación' : 'sesiones próximas sin ubicación'}.{' '}
          <Link to="/coordinacion/talleres/programa" className="font-semibold underline">Asignarla en Talleres → Programa</Link>
        </Alert>
      )}

      <section aria-label={VIEWS.find((v) => v.key === active)?.label}>
        {active === 'ahora' && <NowView views={views.ahora} rows={filtered} now={now} tz={tz} searching={searching} />}
        {active === 'proximas' && (
          views.proximas.length
            ? <SessionTable rows={views.proximas} now={now} timeZone={tz} label="Próximas sesiones" />
            : <Empty searching={searching} text="No quedan sesiones por comenzar." />
        )}
        {active === 'atencion' && (
          views.atencion.length ? (
            <SessionTable rows={views.atencion} now={now} timeZone={tz} label="Sesiones que requieren atención" />
          ) : searching && attentionCount > 0 ? (
            <Empty searching text="" />
          ) : (
            <div className="card flex items-center gap-3 p-5">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-fg-success" aria-hidden />
              <div>
                <p className="font-semibold">Nada requiere acción ahora</p>
                <p className="text-sm text-ink-muted">Aquí solo aparecen situaciones que Coordinación puede resolver; un taller lleno no lo es.</p>
              </div>
            </div>
          )
        )}
        {active === 'programa' && (
          views.programa.length
            ? <SessionTable rows={views.programa} now={now} timeZone={tz} label="Programa completo" />
            : <Empty searching={searching || filters.moment !== '' || filters.demand !== ''} text="Todavía no hay sesiones programadas." />
        )}
      </section>
    </div>
  );
}

function Empty({ searching, text }: { searching: boolean; text: string }) {
  return <Alert>{searching ? 'Ninguna sesión coincide con la búsqueda o los filtros.' : text}</Alert>;
}

function NowView({ views, rows, now, tz, searching }: { views: ReturnType<typeof splitViews>['ahora']; rows: Row[]; now: number; tz: string; searching: boolean }) {
  const { attention, inProgress, soon } = views;
  const nothing = attention.length + inProgress.length + soon.length === 0;
  if (nothing) {
    const next = rows.filter((r) => r.status === 'proxima').sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at)).slice(0, 3);
    return (
      <div className="space-y-4">
        <Alert>
          {searching ? 'Ninguna sesión en curso o por empezar coincide con la búsqueda.' : `Nada en curso ni por empezar en los próximos ${SOON_MINUTES} min.`}
        </Alert>
        {next.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">
              Siguiente · {formatTime(next[0].session.starts_at)} (en {formatSpan(minutesUntilStart(next[0].session, now))})
            </h2>
            <SessionTable rows={next} now={now} timeZone={tz} label="Siguientes sesiones" />
          </div>
        )}
      </div>
    );
  }
  const section = (title: string, list: Row[], dot: string) =>
    list.length > 0 && (
      <div>
        <h2 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-ink"><span aria-hidden className={`h-2 w-2 rounded-full ${dot}`} />{title} · {list.length}</h2>
        <div className="card overflow-clip" data-testid="session-table">
          {list.map((row) => <SessionRow key={row.session.session_id} row={row} now={now} />)}
        </div>
      </div>
    );
  return (
    <div className="space-y-5">
      {section('Requiere atención', attention, 'bg-amber-500')}
      {section('En curso', inProgress, 'bg-emerald-500')}
      {section(`Empiezan pronto (próximos ${SOON_MINUTES} min)`, soon, 'bg-secondary-500')}
    </div>
  );
}
