import type { SessionState } from '../../lib/reservations';

type Tone = 'info' | 'success' | 'warning' | 'error' | 'neutral';

export const STATE_LABELS: Record<SessionState, { label: string; tone: Tone }> = {
  available: { label: 'Disponible', tone: 'success' },
  few: { label: 'Pocos lugares', tone: 'warning' },
  full: { label: 'Llena', tone: 'error' },
  ended: { label: 'Terminó', tone: 'neutral' },
  in_progress: { label: 'En curso · puedes entrar', tone: 'info' },
  cancelled: { label: 'Cancelada', tone: 'error' },
  conflict: { label: 'Choca con tu ruta', tone: 'error' },
  same_workshop: { label: 'Ya en tu ruta', tone: 'neutral' },
  max: { label: 'Ruta completa', tone: 'neutral' },
  reserved: { label: 'Reservada', tone: 'success' },
  not_open: { label: 'Aún no abre', tone: 'neutral' },
  closed: { label: 'Reservas cerradas', tone: 'neutral' },
  already_attended: { label: 'Ya completada', tone: 'success' },
};
