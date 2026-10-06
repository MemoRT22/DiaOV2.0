import {
  ArrowRight, CalendarDays, CheckCircle2, ClipboardList, GitMerge, MapPin,
  MonitorDot, Users, UserRoundX, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Spinner } from '../components/ui';
import { formatDateTime, formatEventDate } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { workshopAdminApi, type WorkshopList } from '../lib/workshopAdminApi';
import { useTheme } from '../theme/ThemeProvider';

type Summary = {
  participants_total: number;
  activities: number;
  sessions: number;
  attendances: number;
  missing_birth_date: number;
  pending_conflicts: number;
};
type Pending = { count: number; label: string; description: string; to: string; action: string; icon: LucideIcon };

export default function Overview() {
  const { edition } = useTheme();
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
  const reviewCount = (workshops?.counts.submitted ?? 0) + (workshops?.counts.in_review ?? 0);
  const approvedCount = workshops?.counts.approved ?? 0;
  const pending: Pending[] = [
    ...(summary.pending_conflicts > 0 ? [{ count: summary.pending_conflicts,
      label: summary.pending_conflicts === 1 ? 'conflicto de importación' : 'conflictos de importación',
      description: 'Hay datos importados que necesitan una decisión.', to: '/coordinacion/conflictos',
      action: 'Resolver conflictos', icon: GitMerge }] : []),
    ...(summary.missing_birth_date > 0 ? [{ count: summary.missing_birth_date,
      label: summary.missing_birth_date === 1 ? 'participante sin fecha de nacimiento' : 'participantes sin fecha de nacimiento',
      description: 'Corrige sus expedientes para que puedan entrar a la plataforma.', to: '/coordinacion/participantes',
      action: 'Buscar participantes', icon: UserRoundX }] : []),
    ...(reviewCount > 0 ? [{ count: reviewCount, label: reviewCount === 1 ? 'propuesta por revisar' : 'propuestas por revisar',
      description: 'Hay propuestas nuevas o en revisión.', to: '/coordinacion/talleres',
      action: 'Revisar talleres', icon: ClipboardList }] : []),
    ...(approvedCount > 0 ? [{ count: approvedCount,
      label: approvedCount === 1 ? 'propuesta lista para publicar' : 'propuestas listas para publicar',
      description: 'Ya fueron aprobadas y esperan publicación.', to: '/coordinacion/talleres',
      action: 'Publicar talleres', icon: ClipboardList }] : []),
  ];
  const quickActions = [
    { to: '/coordinacion/participantes', title: 'Gestionar participantes', description: 'Busca, corrige o registra aspirantes.', icon: Users },
    { to: '/coordinacion/talleres', title: 'Gestionar talleres', description: 'Revisa propuestas y publica actividades.', icon: ClipboardList },
    { to: '/coordinacion/operacion-en-vivo', title: 'Abrir operación del evento',
      description: 'Consulta sesiones, aforo y asistencias.', icon: MonitorDot },
  ];
  const indicators = [
    { label: 'Participantes', value: summary.participants_total },
    { label: 'Talleres', value: summary.activities },
    { label: 'Sesiones', value: summary.sessions },
    { label: 'Asistencias', value: summary.attendances },
  ];

  return <div className="space-y-8">
    <header>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-500">Panel de Coordinación</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold">Inicio</h1>
      <p className="mt-2 text-sm text-ink-muted">Lo que necesita atención para preparar y operar el Día OV.</p>
    </header>

    <section aria-labelledby="pending-title" className="space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-wider text-primary-500">Prioridad</p>
        <h2 id="pending-title" className="mt-1 text-xl font-extrabold">Pendientes</h2>
        <p className="mt-1 text-sm text-ink-muted">Situaciones conocidas que requieren una acción de Coordinación.</p></div>
      {pending.length > 0 ? <div className="space-y-3">
        {pending.map(({ count, label, description, to, action, icon: Icon }) => <Link key={label} to={to}
          className="card group flex items-center gap-4 p-4 transition-colors hover:border-secondary-400 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-theme bg-warning-500/10 text-warning-500">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">{count} {label}</span>
            <span className="mt-0.5 block text-sm text-ink-muted">{description}</span></span>
          <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-primary-500 sm:inline-flex">
            {action}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-primary-500 sm:hidden" aria-hidden />
        </Link>)}
      </div> : workshops && <div className="card flex items-center gap-3 p-5">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-success-500" aria-hidden />
        <div><p className="font-semibold">Sin pendientes conocidos</p>
          <p className="text-sm text-ink-muted">Los indicadores disponibles no muestran tareas por resolver.</p></div>
      </div>}
      {!workshops && <Alert tone="warning">No se pudieron consultar los pendientes de propuestas de talleres.{' '}
        <button onClick={reload} className="font-semibold underline">Reintentar</button>
      </Alert>}
    </section>

    <section aria-labelledby="actions-title" className="space-y-4">
      <div><h2 id="actions-title" className="text-xl font-extrabold">Accesos rápidos</h2>
        <p className="mt-1 text-sm text-ink-muted">Tus tres tareas principales, siempre a mano.</p></div>
      <div className="grid gap-3 md:grid-cols-3">
        {quickActions.map(({ to, title, description, icon: Icon }) => <Link key={to} to={to}
          className="card group flex flex-col gap-4 p-5 transition-colors hover:border-secondary-400 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500">
          <Icon className="h-6 w-6 text-primary-500" aria-hidden />
          <span className="flex-1"><span className="block font-bold">{title}</span>
            <span className="mt-1 block text-sm text-ink-muted">{description}</span></span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary-500">Abrir
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden /></span>
        </Link>)}
      </div>
    </section>

    <section aria-label="Estado del evento" className="card overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Edición actual</p>
          <h2 className="mt-1 font-display text-xl font-extrabold">{edition?.name ?? 'Día OV'}</h2></div>
        <Badge tone={edition?.mode === 'operacion_real' ? 'success' : 'warning'}>
          {edition?.mode === 'operacion_real' ? 'Operación real' : 'Preparación'}
        </Badge>
      </div>
      {edition && <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2 text-ink-muted"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Fecha</dt><dd>{formatEventDate(edition.event_date)} · {edition.start_time} h</dd></div>
        <div className="flex items-center gap-2 text-ink-muted"><MapPin className="h-4 w-4 shrink-0" aria-hidden />
          <dt className="sr-only">Sede</dt><dd>{edition.venue}</dd></div>
      </dl>}
      <p className="mt-5 border-t border-line pt-4 text-xs text-ink-muted">
        {edition?.mode === 'operacion_real'
          ? `Operación real activa desde ${edition.real_operation_at ? formatDateTime(edition.real_operation_at) : '—'}.`
          : <>El sistema está en preparación. Antes del evento, retira los datos de prueba y{' '}
            <Link to="/coordinacion/operacion" className="font-semibold text-ink underline">activa la operación real</Link>.</>}
      </p>
    </section>

    <section aria-labelledby="indicators-title" className="space-y-3">
      <h2 id="indicators-title" className="text-sm font-semibold text-ink-muted">En números</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {indicators.map(({ label, value }) => <div key={label} className="card p-4 sm:p-5">
          <p className="text-xs text-ink-muted">{label}</p><p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
        </div>)}
      </div>
    </section>
  </div>;
}
