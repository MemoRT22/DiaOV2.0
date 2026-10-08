import { isSelectable, sessionState, durationMinutes, type Board, type BoardSession, type MyReservation } from './reservations';

export function workshopDivisionIds(session: BoardSession): string[] {
  return session.division_ids?.length ? [...new Set(session.division_ids)] : session.division_id ? [session.division_id] : [];
}

export function workshopLocation(sessions: BoardSession[]): string | null {
  const locations = [...new Set(sessions.map((s) => s.location))];
  return locations.length === 1 ? locations[0] || null : 'Ubicaciones según horario';
}

export function workshopDuration(sessions: BoardSession[]): string {
  const durations = sessions.map(durationMinutes);
  const shortest = Math.min(...durations);
  const longest = Math.max(...durations);
  return shortest === longest ? `${shortest} min` : `${shortest}–${longest} min`;
}

export function workshopAvailability(board: Board, sessions: BoardSession[], replacing: MyReservation | null): string {
  if (sessions.some((s) => s.in_progress)) return 'En curso';
  const count = sessions.filter((s) => isSelectable(sessionState(board, s, replacing))).length;
  if (count) return `${count} ${count === 1 ? 'horario disponible' : 'horarios disponibles'}`;
  if (sessions.every((s) => s.remaining <= 0)) return 'Sin lugares disponibles';
  return 'Consulta horarios';
}

export function workshopPersonalStatus(sessions: BoardSession[], attended?: boolean, reserved?: boolean): 'Explorado' | 'En tu ruta' | null {
  if (attended || sessions.some((s) => s.attended)) return 'Explorado';
  if (reserved || sessions.some((s) => !!s.my_reservation_id)) return 'En tu ruta';
  return null;
}
