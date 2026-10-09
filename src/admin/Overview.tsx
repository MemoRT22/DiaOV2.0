import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Button, Spinner } from '../components/ui';
import { formatEventDate } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { workshopAdminApi, type WorkshopList } from '../lib/workshopAdminApi';
import { useEdition } from '../edition/EditionProvider';

type Summary = {
  participants_total: number;
  activities: number;
  sessions: number;
  attendances: number;
  pending_conflicts: number;
};
type Pending = { count: number; label: string; description: string; to: string; action: string };

export default function Overview() {
  const { edition } = useEdition();
  const { data, error, loading, reload } = useLoad(async () => {
    const [result, workshops] = await Promise.all([
      supabase.rpc('coordination_summary'),
      workshopAdminApi.list({}).catch(() => null),
    ]);
    if (result.error) throw result.error;
    if (!result.data || typeof result.data.participants_total !== 'number') throw new Error('INVALID_SUMMARY');
    return { summary: result.data as Summary, workshops: workshops as WorkshopList | null };
  }, []);

  if (loading && !data) return <Spinner label="Cargando Inicio" />;
  if (error || !data) return <div className="space-y-4">
    <Alert tone="error">{friendlyError(error)}</Alert>
    <Button variant="secondary" onClick={reload}>Reintentar</Button>
  </div>;

  const { summary, workshops } = data;
  const reviewCount = workshops?.counts.pending ?? 0;
  const pending: Pending[] = [
    ...(summary.pending_conflicts > 0 ? [{ count: summary.pending_conflicts,
      label: summary.pending_conflicts === 1 ? 'dato de importación por revisar' : 'datos de importación por revisar',
      description: 'Una importación trajo datos distintos a correcciones hechas a mano.', to: '/coordinacion/participantes/importar',
      action: 'Revisar' }] : []),
    ...(reviewCount > 0 ? [{ count: reviewCount, label: reviewCount === 1 ? 'taller por revisar' : 'talleres por revisar',
      description: 'Hay talleres pendientes de decisión.', to: '/coordinacion/talleres', action: 'Revisar talleres' }] : []),
  ];
  const quickActions = [
    { to: '/coordinacion/participantes', title: 'Gestionar participantes', description: 'Busca participantes, corrige datos y restablece contraseñas.' },
    { to: '/coordinacion/talleres', title: 'Gestionar talleres', description: 'Revisa, edita y administra talleres.' },
    { to: '/coordinacion/operacion-en-vivo', title: 'Abrir operación del evento', description: 'Consulta sesiones, aforo y asistencias.' },
  ];
  const indicators = [
    { label: 'Participantes', value: summary.participants_total },
    { label: 'Talleres', value: summary.activities },
    { label: 'Sesiones', value: summary.sessions },
    { label: 'Asistencias', value: summary.attendances },
  ];

  return <div className="space-y-9">
    <header className="admin-hero pb-7 pt-1">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">Panel de Coordinación</p>
      <h1 className="mt-2">Inicio</h1>
      <p className="mt-2 text-sm text-ink-muted">Resumen del evento y tareas que necesitan atención.</p>
    </header>

    <section aria-labelledby="indicators-title" className="space-y-3">
      <h2 id="indicators-title" className="text-sm font-semibold text-ink">En números</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {indicators.map(({ label, value }) => <div key={label} className="card admin-stat flex flex-col justify-between p-4 sm:p-5">
          <p className="text-sm text-ink-muted">{label}</p>
          <p className="mt-5 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
        </div>)}
      </div>
    </section>

    <section aria-labelledby="pending-title" className="space-y-3">
      <div>
        <h2 id="pending-title" className="text-lg">Pendientes</h2>
        <p className="mt-1 text-sm text-ink-muted">Situaciones conocidas que requieren una acción de Coordinación.</p>
      </div>
      {pending.length > 0 ? <div className="card divide-y divide-line overflow-hidden">
        {pending.map(({ count, label, description, to, action }) => <Link key={label} to={to}
          className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-raised sm:px-5">
          <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg bg-warning-500/10 px-2 text-sm font-bold text-fg-warning">{count}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{count} {label}</span>
            <span className="mt-0.5 block text-sm text-ink-muted">{description}</span></span>
          <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-fg-brand sm:inline-flex">
            {action}<ArrowRight className="h-4 w-4" aria-hidden />
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-fg-brand sm:hidden" aria-hidden />
        </Link>)}
      </div> : workshops && <div className="card flex items-center gap-3 p-4 sm:p-5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success-500" aria-hidden />
        <div><p className="text-sm font-semibold">Sin pendientes conocidos</p>
          <p className="mt-0.5 text-sm text-ink-muted">Los indicadores disponibles no muestran tareas por resolver.</p></div>
      </div>}
      {!workshops && <Alert tone="warning">No se pudieron consultar los talleres pendientes.{' '}
        <button onClick={reload} className="font-semibold underline">Reintentar</button>
      </Alert>}
    </section>

    <section aria-labelledby="actions-title" className="space-y-3">
      <div>
        <h2 id="actions-title" className="text-lg">Accesos rápidos</h2>
        <p className="mt-1 text-sm text-ink-muted">Ve directo a las tareas más frecuentes.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {quickActions.map(({ to, title, description }, index) => <Link key={to} to={to}
          className="card group flex min-h-44 flex-col p-5 focus-visible:outline-none">
          <span className="text-xs font-semibold tabular-nums text-fg-brand">0{index + 1}</span>
          <span className="mt-4 flex-1"><span className="block text-base font-semibold">{title}</span>
            <span className="mt-1.5 block text-sm text-ink-muted">{description}</span></span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-fg-brand">Abrir
            <ArrowRight className="h-4 w-4" aria-hidden /></span>
        </Link>)}
      </div>
    </section>

    <section aria-label="Estado del evento" className="card p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Edición actual</p>
      <h2 className="mt-2 text-lg">{edition?.name ?? 'Día OV'}</h2>
      {edition && <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-ink-muted">Fecha</dt><dd className="mt-1 font-medium">{formatEventDate(edition.event_date)} · {edition.start_time} h</dd></div>
        <div><dt className="text-xs text-ink-muted">Sede</dt><dd className="mt-1 font-medium">{edition.venue}</dd></div>
      </dl>}
    </section>
  </div>;
}
