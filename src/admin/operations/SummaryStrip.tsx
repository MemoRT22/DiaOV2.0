import {
  AlertTriangle, BookmarkCheck, CalendarClock, ClipboardList, Clock, Gauge, Radio, Ticket, UserCheck, Users, type LucideIcon,
} from 'lucide-react';
import type { EventPhase } from '../../lib/operationsHelpers';
import type { OperationsSummary } from '../../lib/operationsApi';

type Item = { label: string; value: string | number; hint?: string; tone?: 'warning' };

/**
 * A compact strip of at most five indicators that adapts to the moment: during the event, what is running and what
 * needs attention; before it, how much program there is and how much of it is reserved.
 */
export function summaryItems(
  phase: EventPhase,
  summary: OperationsSummary,
  counts: { inProgress: number; upcoming: number; attention: number; scheduledSessions: number },
): Item[] {
  if (phase === 'pre') {
    const pct = summary.capacity_total > 0 ? Math.round((summary.reserved_total / summary.capacity_total) * 100) : 0;
    return [
      { label: 'Talleres', value: summary.activities_total },
      { label: 'Sesiones', value: counts.scheduledSessions },
      { label: 'Con reservación', value: summary.participants_with_reservations, hint: 'participantes' },
      { label: 'Reservaciones vigentes', value: summary.active_reservations },
      { label: 'Cupo reservado', value: `${pct}%`, hint: `${summary.reserved_total} de ${summary.capacity_total}` },
    ];
  }
  return [
    { label: 'En curso', value: counts.inProgress },
    { label: 'Próximas', value: counts.upcoming },
    { label: 'Requieren atención', value: counts.attention, tone: counts.attention > 0 ? 'warning' : undefined },
    { label: 'Asistencias', value: summary.total_attendances },
    { label: 'Con asistencia', value: summary.unique_attended_participants, hint: 'participantes' },
  ];
}

/** Icon and colour identity per indicator (presentation only). */
const LOOK: Record<string, { icon: LucideIcon; chip: string; glow: string; live?: boolean }> = {
  'En curso': { icon: Radio, chip: 'bg-emerald-500/10 text-emerald-600', glow: 'rgb(16 185 129 / 0.18)', live: true },
  'Próximas': { icon: Clock, chip: 'bg-secondary-500/10 text-secondary-600', glow: 'rgb(91 107 134 / 0.18)' },
  'Requieren atención': { icon: AlertTriangle, chip: 'bg-amber-500/10 text-amber-600', glow: 'rgb(217 119 6 / 0.2)' },
  'Asistencias': { icon: UserCheck, chip: 'bg-primary-500/10 text-primary-700', glow: 'rgb(242 92 5 / 0.16)' },
  'Con asistencia': { icon: Users, chip: 'bg-accent-500/10 text-accent-700', glow: 'rgb(77 124 104 / 0.18)' },
  'Talleres': { icon: ClipboardList, chip: 'bg-primary-500/10 text-primary-700', glow: 'rgb(242 92 5 / 0.16)' },
  'Sesiones': { icon: CalendarClock, chip: 'bg-secondary-500/10 text-secondary-600', glow: 'rgb(91 107 134 / 0.18)' },
  'Con reservación': { icon: Ticket, chip: 'bg-accent-500/10 text-accent-700', glow: 'rgb(77 124 104 / 0.18)' },
  'Reservaciones vigentes': { icon: BookmarkCheck, chip: 'bg-neutral-500/10 text-neutral-700', glow: 'rgb(120 113 108 / 0.18)' },
  'Cupo reservado': { icon: Gauge, chip: 'bg-primary-500/10 text-primary-700', glow: 'rgb(242 92 5 / 0.16)' },
};
const FALLBACK = LOOK['Talleres'];

export default function SummaryStrip({ items }: { items: Item[] }) {
  return (
    <dl aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item) => {
        const look = LOOK[item.label] ?? FALLBACK;
        const Icon = look.icon;
        const warn = item.tone === 'warning';
        return (
          <div
            key={item.label}
            className={`card admin-stat flex flex-col gap-3 px-4 py-4 ${warn ? 'ring-1 ring-amber-500/40 bg-gradient-to-br from-amber-500/[0.07] to-surface' : ''}`}
            style={{ ['--stat-glow' as string]: look.glow }}
          >
            <span className={`relative flex h-9 w-9 items-center justify-center rounded-xl ${look.chip}`}>
              <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
              {look.live && <span aria-hidden className="admin-pulse absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 text-emerald-500 ring-2 ring-white" />}
            </span>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{item.label}</dt>
              <dd className={`mt-0.5 font-display text-3xl font-extrabold tabular-nums leading-none tracking-tight ${warn ? 'text-fg-warning' : ''}`}>
                {item.value}
                {item.hint && <span className="ml-1.5 font-body text-xs font-normal tracking-normal text-ink-muted">{item.hint}</span>}
              </dd>
            </div>
          </div>
        );
      })}
    </dl>
  );
}
