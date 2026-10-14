import { CalendarClock, Lock } from 'lucide-react';
import { formatDateTime, formatTime } from '../../lib/catalog';
import type { Board } from '../../lib/reservations';

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cancun' }).format(new Date(iso));

/**
 * Reservation window as a quiet, one-line status: it informs without competing with the missions.
 * While it is simply open it is one small line (not a box) and, with `hideOpen`, it disappears: «Mi ruta» only needs to
 * speak up when something is restricted.
 */
export default function WindowNotice({ board, hideOpen = false }: { board: Board; hideOpen?: boolean }) {
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
  if (board.closes_at && !hideOpen) {
    const today = dayKey(board.closes_at) === dayKey(board.server_time);
    return (
      <p role="status" className="flex items-center gap-1.5 px-1 text-xs font-semibold text-ink-muted">
        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-fg-info" aria-hidden />
        Reservas abiertas hasta {today ? `hoy a las ${formatTime(board.closes_at)}` : formatDateTime(board.closes_at)}
      </p>
    );
  }
  return null;
}
