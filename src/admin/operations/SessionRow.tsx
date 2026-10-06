import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime } from '../../lib/catalog';
import {
  checkinHref, demandOf, formatSpan, hasLocation, minutesUntilStart, reservationPercent, TEMPORAL_LABELS, type Row,
} from '../../lib/operationsHelpers';

export const GRID =
  'lg:grid lg:grid-cols-[5.75rem_minmax(10rem,1fr)_7.5rem_7.5rem_3rem_10.5rem_8.25rem] lg:items-center lg:gap-x-3';

export function TableHeader() {
  return (
    <div className={`${GRID} hidden border-b border-line bg-surface-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted`}>
      <span>Hora</span>
      <span>Taller</span>
      <span>Lugar</span>
      <span>Reservados</span>
      <span>Asist.</span>
      <span>Estado</span>
      <span className="sr-only">Acción</span>
    </div>
  );
}

const STATE_TONE: Record<Row['status'], string> = {
  proxima: 'bg-secondary-500/10 text-fg-info',
  en_curso: 'bg-emerald-500/10 text-fg-success',
  terminada: 'bg-neutral-500/10 text-ink-muted',
  cancelada: 'bg-error-500/10 text-fg-error',
  oculta: 'bg-neutral-500/10 text-ink-muted',
};

/** Bar colour follows demand: calm while there is room, warmer as the session fills. */
const barTone = (pct: number) =>
  pct >= 100 ? 'from-secondary-400 to-secondary-600' : pct >= 85 ? 'from-amber-400 to-amber-500' : 'from-primary-300 to-primary-500';

/** One session = one compact row. No per-session metric boxes, no stacked badges. */
export default function SessionRow({ row, now }: { row: Row; now: number }) {
  const { session, status, attention } = row;
  const demand = demandOf(session, status);
  const pct = reservationPercent(session);
  const located = hasLocation(session);
  const divisions = session.divisions.map((d) => d.name);
  const shown = divisions.length > 2 ? `${divisions.slice(0, 2).join(' · ')} +${divisions.length - 2}` : divisions.join(' · ');
  const canCheckin = status !== 'cancelada' && status !== 'oculta';
  const countdown = status === 'proxima' ? ` · en ${formatSpan(minutesUntilStart(session, now))}` : '';

  return (
    <div
      data-status={status}
      data-attention={attention.length > 0}
      className={`admin-session-row flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/70 px-4 py-3.5 last:border-b-0 sm:px-5 lg:py-3 ${GRID}`}
    >
      <span className="order-1 text-[0.95rem] font-bold tabular-nums tracking-tight lg:order-1">
        {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
      </span>

      <div className="order-3 min-w-0 basis-full lg:order-2 lg:basis-auto">
        <p className="line-clamp-2 font-semibold leading-snug" title={session.title}>{session.title}</p>
        {shown && <p className="truncate text-xs text-ink-muted" title={divisions.join(' · ')}>{shown}</p>}
      </div>

      <span className={`order-4 line-clamp-2 text-sm leading-snug lg:order-3 ${located ? 'text-ink-muted lg:text-ink' : 'font-semibold text-fg-warning'}`} title={session.location ?? undefined}>
        {located ? session.location : 'Sin ubicación'}
      </span>

      <div className="order-5 ml-auto text-sm lg:order-4 lg:ml-0">
        <span className="font-semibold tabular-nums">{session.reserved}/{session.capacity}</span>
        <span className="ml-1.5 text-xs text-ink-muted">
          {demand === 'lleno' ? <span className="font-semibold text-fg-info">Lleno</span> : demand === 'pocos' ? `Quedan ${session.remaining}` : `${pct}%`}
        </span>
        <div className="mt-1.5 hidden h-1.5 overflow-hidden rounded-full bg-neutral-500/15 lg:block" aria-hidden>
          <div className={`h-full rounded-full bg-gradient-to-r ${barTone(pct)}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <span className="order-6 text-sm tabular-nums lg:order-5">
        <span className="text-xs text-ink-muted lg:hidden">Asistencias </span>
        {session.attended}
      </span>

      <div className="order-2 ml-auto text-sm lg:order-6 lg:ml-0">
        <p className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-wide ${STATE_TONE[status]}`}>
          {TEMPORAL_LABELS[status]}
          <span className="font-semibold normal-case tracking-normal text-ink-muted">{countdown}</span>
        </p>
        {attention.map((a) => (
          <p key={a.kind} className={`text-xs font-semibold ${a.tone === 'error' ? 'text-fg-error' : 'text-fg-warning'}`}>{a.label}</p>
        ))}
      </div>

      <div className="order-7 w-full lg:order-7 lg:w-auto lg:text-right">
        {canCheckin && (
          <Link
            to={checkinHref(session.session_id)}
            aria-label={`Abrir check-in de ${session.title}`}
            className="group inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 text-xs font-semibold text-ink shadow-sm transition-all hover:border-primary-400 hover:bg-primary-500/5 hover:text-primary-700 focus-visible:outline-none"
          >
            Abrir check-in
            <ArrowUpRight className="h-3.5 w-3.5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
