import type { SessionState } from '../../lib/reservations';
import type { StatusKind } from '../ui/StatusPill';

/** One word + one look per session state, shared by the mission detail (time slots). */
export const STATE_LABELS: Record<SessionState, { label: string; kind: StatusKind }> = {
  available: { label: 'Disponible', kind: 'available' },
  few: { label: 'Pocos lugares', kind: 'few' },
  full: { label: 'Llena', kind: 'full' },
  ended: { label: 'Terminó', kind: 'ended' },
  in_progress: { label: 'En curso · puedes entrar', kind: 'live' },
  cancelled: { label: 'Cancelada', kind: 'cancelled' },
  conflict: { label: 'Choca con tu ruta', kind: 'full' },
  same_workshop: { label: 'Ya en tu ruta', kind: 'in_route' },
  max: { label: 'Ruta completa', kind: 'waiting' },
  reserved: { label: 'Reservada', kind: 'in_route' },
  not_open: { label: 'Aún no abre', kind: 'waiting' },
  closed: { label: 'Reservas cerradas', kind: 'waiting' },
  already_attended: { label: 'Completada', kind: 'done' },
};
