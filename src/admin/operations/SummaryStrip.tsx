import type { EventPhase } from '../../lib/operationsHelpers';
import type { OperationsSummary } from '../../lib/operationsApi';

const GLOWS = ['rgb(47 95 227 / 0.16)', 'rgb(255 89 0 / 0.16)', 'rgb(245 158 11 / 0.18)', 'rgb(124 58 237 / 0.14)', 'rgb(16 185 129 / 0.16)'];

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

export default function SummaryStrip({ items }: { items: Item[] }) {
  return (
    <dl aria-label="Indicadores" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((item, index) => (
        <div key={item.label} className="card admin-stat px-4 py-3.5" style={{ ['--stat-glow' as string]: GLOWS[index % GLOWS.length] }}>
          <dt className="text-xs text-ink-muted">{item.label}</dt>
          <dd className={`font-display text-2xl font-extrabold tabular-nums ${item.tone === 'warning' ? 'text-fg-warning' : ''}`}>
            {item.value}
            {item.hint && <span className="ml-1.5 font-body text-xs font-normal text-ink-muted">{item.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
