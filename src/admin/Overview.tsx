import {
  ArrowRight, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, GitMerge, MapPin,
  MonitorDot, Users, type LucideIcon,
} from 'lucide-react';
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
type Pending = { count: number; label: string; description: string; to: string; action: string; icon: LucideIcon };

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
      action: 'Revisar', icon: GitMerge }] : []),
    ...(reviewCount > 0 ? [{ count: reviewCount, label: reviewCount === 1 ? 'taller por revisar' : 'talleres por revisar',
      description: 'Hay talleres pendientes de decisión.', to: '/coordinacion/talleres',
      action: 'Revisar talleres', icon: ClipboardList }] : []),
  ];
  const quickActions = [
    { to: '/coordinacion/participantes', title: 'Gestionar participantes', description: 'Busca participantes, corrige datos y restablece contraseñas.', icon: Users,
      tint: 'from-primary-400 to-primary-600 shadow-[0_10px_22px_-10px_rgba(242,92,5,0.8)]' },
    { to: '/coordinacion/talleres', title: 'Gestionar talleres', description: 'Revisa, edita y administra talleres.', icon: ClipboardList,
      tint: 'from-neutral-600 to-neutral-800 shadow-[0_10px_22px_-10px_rgba(28,25,23,0.6)]' },
    { to: '/coordinacion/operacion-en-vivo', title: 'Abrir operación del evento',
      description: 'Consulta sesiones, aforo y asistencias.', icon: MonitorDot,
      tint: 'from-accent-400 to-accent-600 shadow-[0_10px_22px_-10px_rgba(77,124,104,0.7)]' },
  ];
  const indicators = [
    { label: 'Participantes', value: summary.participants_total, icon: Users, chip: 'bg-neutral-500/10 text-neutral-700', glow: 'rgb(120 113 108 / 0.16)' },
    { label: 'Talleres', value: summary.activities, icon: ClipboardList, chip: 'bg-primary-500/10 text-primary-700', glow: 'rgb(242 92 5 / 0.15)' },
    { label: 'Sesiones', value: summary.sessions, icon: CalendarClock, chip: 'bg-secondary-500/10 text-secondary-600', glow: 'rgb(91 107 134 / 0.16)' },
    { label: 'Asistencias', value: summary.attendances, icon: ClipboardCheck, chip: 'bg-accent-500/10 text-accent-700', glow: 'rgb(77 124 104 / 0.16)' },
  ];

  return <div className="space-y-10">
    <header className="admin-hero rounded-[1.75rem] px-6 py-8 sm:px-10 sm:py-11">
      <div className="relative z-10 max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-fg-brand">Panel de Coordinación</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">Inicio</h1>
        <p className="mt-3 text-base text-ink-muted">Lo que necesita atención en el Día OV.</p>
      </div>
    </header>

    <section aria-labelledby="indicators-title" className="space-y-4">
      <h2 id="indicators-title" className="text-sm font-semibold uppercase tracking-wider text-ink-muted">En números</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {indicators.map(({ label, value, icon: Icon, chip, glow }) => <div key={label} className="card admin-stat p-5"
          style={{ ['--stat-glow' as string]: glow }}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}><Icon className="h-5 w-5" aria-hidden /></span>
          <p className="mt-4 text-sm font-medium text-ink-muted">{label}</p>
          <p className="mt-1 font-display text-4xl font-extrabold tabular-nums tracking-tight">{value}</p>
        </div>)}
      </div>
    </section>

    <section aria-labelledby="pending-title" className="space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-wider text-fg-brand">Prioridad</p>
        <h2 id="pending-title" className="mt-1 text-2xl font-extrabold">Pendientes</h2>
        <p className="mt-1 text-sm text-ink-muted">Situaciones conocidas que requieren una acción de Coordinación.</p></div>
      {pending.length > 0 ? <div className="space-y-3">
        {pending.map(({ count, label, description, to, action, icon: Icon }) => <Link key={label} to={to}
          className="card group flex items-center gap-4 border-l-4 border-l-warning-500 p-4 transition-colors hover:bg-surface-raised focus-visible:outline-none sm:p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning-500/10 text-fg-warning">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">{count} {label}</span>
            <span className="mt-0.5 block text-sm text-ink-muted">{description}</span></span>
          <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-fg-brand sm:inline-flex">
            {action}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-fg-brand sm:hidden" aria-hidden />
        </Link>)}
      </div> : workshops && <div className="card flex items-center gap-4 bg-gradient-to-r from-emerald-500/[0.08] via-surface to-surface p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div><p className="font-semibold">Sin pendientes conocidos</p>
          <p className="text-sm text-ink-muted">Los indicadores disponibles no muestran tareas por resolver.</p></div>
      </div>}
      {!workshops && <Alert tone="warning">No se pudieron consultar los talleres pendientes.{' '}
        <button onClick={reload} className="font-semibold underline">Reintentar</button>
      </Alert>}
    </section>

    <section aria-labelledby="actions-title" className="space-y-4">
      <div><h2 id="actions-title" className="text-2xl font-extrabold">Accesos rápidos</h2>
        <p className="mt-1 text-sm text-ink-muted">Tus tres tareas principales, siempre a mano.</p></div>
      <div className="grid gap-4 md:grid-cols-3">
        {quickActions.map(({ to, title, description, icon: Icon, tint }) => <Link key={to} to={to}
          className="card group flex flex-col gap-5 p-6 focus-visible:outline-none">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white ${tint}`}>
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <span className="flex-1"><span className="block font-display text-lg font-bold">{title}</span>
            <span className="mt-1.5 block text-sm text-ink-muted">{description}</span></span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-brand">Abrir
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1.5" aria-hidden /></span>
        </Link>)}
      </div>
    </section>

    <section aria-label="Estado del evento" className="card overflow-hidden p-0">
      <div className="h-1.5 bg-gradient-to-r from-primary-500 via-primary-300 to-neutral-300" aria-hidden />
      <div className="p-5 sm:p-7">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Edición actual</p>
          <h2 className="mt-1 font-display text-2xl font-extrabold">{edition?.name ?? 'Día OV'}</h2></div>
        {edition && <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-xl bg-surface-raised px-4 py-3 text-ink"><CalendarDays className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
            <dt className="sr-only">Fecha</dt><dd className="font-medium">{formatEventDate(edition.event_date)} · {edition.start_time} h</dd></div>
          <div className="flex items-center gap-3 rounded-xl bg-surface-raised px-4 py-3 text-ink"><MapPin className="h-4 w-4 shrink-0 text-fg-brand" aria-hidden />
            <dt className="sr-only">Sede</dt><dd className="font-medium">{edition.venue}</dd></div>
        </dl>}
      </div>
    </section>
  </div>;
}
