import { Link } from 'react-router-dom';
import { formatTime } from '../../lib/catalog';
import {
  checkinHref, demandOf, formatSpan, hasLocation, minutesUntilStart, reservationPercent, TEMPORAL_LABELS, type Row,
} from '../../lib/operationsHelpers';

export const GRID =
  'lg:grid lg:grid-cols-[5.75rem_minmax(10rem,1fr)_7.5rem_7.5rem_3rem_10.5rem_6.5rem] lg:items-center lg:gap-x-3';

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
  proxima: 'text-fg-info',
  en_curso: 'text-fg-success',
  terminada: 'text-ink-muted',
  cancelada: 'text-fg-error',
  oculta: 'text-ink-muted',
};

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
      className={`flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 hover:bg-surface-raised lg:py-2.5 ${GRID}`}
    >
      <span className="text-sm font-semibold tabular-nums">
        {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
      </span>

      <div className="min-w-0">
        <p className="line-clamp-2 font-semibold leading-snug" title={session.title}>{session.title}</p>
        {shown && <p className="truncate text-xs text-ink-muted" title={divisions.join(' · ')}>{shown}</p>}
      </div>

      <span className={`line-clamp-2 text-sm leading-snug ${located ? '' : 'font-semibold text-fg-warning'}`} title={session.location ?? undefined}>
        {located ? session.location : 'Sin ubicación'}
      </span>

      <div className="text-sm">
        <span className="font-semibold tabular-nums">{session.reserved}/{session.capacity}</span>
        <span className="ml-1.5 text-xs text-ink-muted">
          {demand === 'lleno' ? <span className="font-semibold text-fg-info">Lleno</span> : demand === 'pocos' ? `Quedan ${session.remaining}` : `${pct}%`}
        </span>
        <div className="mt-1 hidden h-1 overflow-hidden rounded-full bg-surface-sunken lg:block" aria-hidden>
          <div className="h-full rounded-full bg-secondary-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <span className="text-sm tabular-nums">
        <span className="text-xs text-ink-muted lg:hidden">Asistencias </span>
        {session.attended}
      </span>

      <div className="text-sm">
        <p className={`text-xs font-bold uppercase tracking-wide ${STATE_TONE[status]}`}>
          {TEMPORAL_LABELS[status]}
          <span className="font-semibold normal-case tracking-normal text-ink-muted">{countdown}</span>
        </p>
        {attention.map((a) => (
          <p key={a.kind} className={`text-xs font-semibold ${a.tone === 'error' ? 'text-fg-error' : 'text-fg-warning'}`}>{a.label}</p>
        ))}
      </div>

      <div className="lg:text-right">
        {canCheckin && (
          <Link
            to={checkinHref(session.session_id)}
            aria-label={`Abrir check-in de ${session.title}`}
            className="inline-flex min-h-8 items-center whitespace-nowrap rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500"
          >
            Abrir check-in
          </Link>
        )}
      </div>
    </div>
  );
}
