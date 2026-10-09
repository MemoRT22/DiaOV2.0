import { CalendarClock, Lock } from 'lucide-react';
import { formatDateTime } from '../../lib/catalog';
import type { Board } from '../../lib/reservations';

/** Reservation window as a quiet, one-line status: it informs without competing with the missions. */
export default function WindowNotice({ board }: { board: Board }) {
  const row = (tone: 'info' | 'warning', icon: typeof Lock, text: string) => {
    const Icon = icon;
    return (
      <p
        role="status"
        className={`flex items-start gap-2 rounded-theme border px-3 py-2.5 text-sm ${
          tone === 'warning' ? 'border-warning-500/45 bg-warning-500/10' : 'border-line bg-surface/70 text-ink-muted'
        }`}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'warning' ? 'text-fg-warning' : 'text-fg-info'}`} aria-hidden />
        <span className="min-w-0">{text}</span>
      </p>
    );
  };
  if (board.window === 'not_open') {
    return row(
      'info',
      CalendarClock,
      `${board.opens_at ? `Las reservaciones abren el ${formatDateTime(board.opens_at)}` : 'Las reservaciones aún no abren'} · Mientras, puedes conocer las misiones.`,
    );
  }
  if (board.window === 'closed') {
    return row('warning', Lock, 'Las reservaciones cerraron. Puedes cancelar una misión que aún no termine, pero ya no reservar ni cambiar.');
  }
  if (board.closes_at) return row('info', CalendarClock, `Reservaciones abiertas hasta el ${formatDateTime(board.closes_at)}`);
  return null;
}
