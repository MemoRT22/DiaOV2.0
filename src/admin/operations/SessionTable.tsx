import { formatTime } from '../../lib/catalog';
import { groupByStart, type Row } from '../../lib/operationsHelpers';
import SessionRow, { TableHeader } from './SessionRow';

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** High-density table: sessions grouped by start time, one compact row each. Comfortable with 100+ rows. */
export default function SessionTable({ rows, now, timeZone, label }: { rows: Row[]; now: number; timeZone: string; label: string }) {
  const blocks = groupByStart(rows, timeZone);
  const multiDay = new Set(blocks.map((b) => b.day)).size > 1;
  let lastDay = '';
  return (
    <div className="card overflow-clip" data-testid="session-table" aria-label={label}>
      <TableHeader />
      {blocks.map((block) => {
        const showDay = multiDay && block.day !== lastDay;
        lastDay = block.day;
        return (
          <section key={block.key} aria-label={`Bloque ${formatTime(block.startsAt)}`}>
            {showDay && <p className="bg-surface-sunken px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-muted">{dayLabel(block.day)}</p>}
            <div className="sticky top-14 z-10 flex items-center gap-2 border-b border-line bg-surface-sunken px-4 py-1 text-xs font-bold text-ink-muted lg:top-0">
              <span className="tabular-nums text-sm text-ink">{formatTime(block.startsAt)}</span>
              <span>{block.rows.length} {block.rows.length === 1 ? 'sesión' : 'sesiones'}</span>
            </div>
            {block.rows.map((row) => (
              <SessionRow key={row.session.session_id} row={row} now={now} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
