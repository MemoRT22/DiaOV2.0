import type { OperationsSession } from './operationsApi';

export type TemporalStatus = 'proxima' | 'en_curso' | 'terminada' | 'cancelada' | 'oculta';

const FEW_PLACES_RATIO = 0.15;
const UPCOMING_WINDOW_MS = 60 * 60 * 1000;

export function temporalStatus(session: OperationsSession, serverTime: number): TemporalStatus {
  if (session.status === 'cancelada') return 'cancelada';
  if (session.status === 'oculta') return 'oculta';
  const start = new Date(session.starts_at).getTime();
  const end = new Date(session.ends_at).getTime();
  if (serverTime < start) return 'proxima';
  if (serverTime >= start && serverTime < end) return 'en_curso';
  return 'terminada';
}

export type SignalTone = 'error' | 'warning' | 'neutral';

export type AttentionSignal = { label: string; tone: SignalTone };

export function attentionSignals(
  session: OperationsSession,
  status: TemporalStatus,
  serverTime: number,
  checkinCloseAfterMinutes: number,
): AttentionSignal[] {
  const signals: AttentionSignal[] = [];

  if (status === 'cancelada') {
    signals.push({ label: 'CANCELADA', tone: 'error' });
    return signals;
  }

  if (session.remaining <= 0 && status !== 'terminada') {
    signals.push({ label: 'LLENA', tone: 'error' });
  }

  if (session.remaining > 0 && session.remaining <= Math.max(3, Math.ceil(session.capacity * FEW_PLACES_RATIO)) && status !== 'terminada') {
    signals.push({ label: 'POCOS LUGARES', tone: 'warning' });
  }

  if (status === 'proxima' && session.reserved === 0) {
    signals.push({ label: 'SIN RESERVAS', tone: 'warning' });
  }

  if (status === 'terminada' && session.reserved > 0 && session.attended === 0) {
    const end = new Date(session.ends_at).getTime();
    const checkinClose = end + checkinCloseAfterMinutes * 60 * 1000;
    if (serverTime < checkinClose) {
      signals.push({ label: 'CHECK-IN PENDIENTE', tone: 'warning' });
    } else {
      signals.push({ label: 'SIN ASISTENCIAS', tone: 'neutral' });
    }
  }

  return signals;
}

export function hasAttention(
  session: OperationsSession,
  status: TemporalStatus,
  serverTime: number,
  checkinCloseAfterMinutes: number,
): boolean {
  return attentionSignals(session, status, serverTime, checkinCloseAfterMinutes).some((s) => s.tone !== 'neutral');
}

export function attendanceRate(session: OperationsSession): number | null {
  if (session.reserved <= 0) return null;
  return Math.round((session.attended / session.reserved) * 100);
}

export function reservationPercent(session: OperationsSession): number {
  if (session.capacity <= 0) return 0;
  return Math.min(100, Math.round((session.reserved / session.capacity) * 100));
}

export function formatUpdatedAgo(serverTime: string): string {
  const diff = Math.max(0, Date.now() - new Date(serverTime).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `Actualizado hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `Actualizado hace ${minutes}m`;
}

export function isUpcomingSoon(session: OperationsSession, serverTime: number): boolean {
  const start = new Date(session.starts_at).getTime();
  const diff = start - serverTime;
  return diff >= 0 && diff <= UPCOMING_WINDOW_MS;
}

export const TEMPORAL_LABELS: Record<TemporalStatus, string> = {
  proxima: 'Próxima',
  en_curso: 'En curso',
  terminada: 'Terminada',
  cancelada: 'Cancelada',
  oculta: 'Oculta',
};

export const TEMPORAL_TONES: Record<TemporalStatus, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  proxima: 'info',
  en_curso: 'success',
  terminada: 'neutral',
  cancelada: 'error',
  oculta: 'neutral',
};
