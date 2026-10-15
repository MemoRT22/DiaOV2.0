import type { Board } from './reservations';

/**
 * Sellos que la ruta actual PODRÍA dar, separados de los que ya se obtuvieron. Todo sale del tablero que la pantalla ya tiene (sin
 * consultas extra) y de los créditos que el servidor reporta por sesión (`BoardSession.credits`): nunca se infieren de la duración.
 *
 * - `earned`: sellos de asistencias ya confirmadas (`derived_status = 'completed'`, créditos realmente otorgados). Es lo único que
 *   mueve el rango real, y lo decide el servidor al confirmar la asistencia.
 * - `planned`: créditos de las reservaciones vigentes que aún no se asisten (`active` / `in_progress`). Es un potencial, no un logro.
 *
 * No cuentan: canceladas, vencidas (`expired`), terminadas sin asistencia (`ended`), ni una misión cuya asistencia ya se contabilizó
 * (aunque otra reservación de la misma misión siga en el tablero): cada misión aporta una sola vez.
 */
export type StampProjection = { earned: number; planned: number; total: number };

const credit = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function projectStamps(board: Pick<Board, 'sessions' | 'reservations'>): StampProjection {
  const sessionById = new Map(board.sessions.map((s) => [s.id, s]));
  const attended = new Map<string, number>(); // misión → sellos ya otorgados (una vez)
  for (const r of board.reservations) {
    if (r.derived_status === 'completed' && !attended.has(r.activity_id)) attended.set(r.activity_id, credit(r.credits_granted));
  }
  const counted = new Set<string>();
  let planned = 0;
  for (const r of board.reservations) {
    if (r.status !== 'vigente' || (r.derived_status !== 'active' && r.derived_status !== 'in_progress')) continue;
    if (attended.has(r.activity_id) || counted.has(r.activity_id)) continue;
    const session = sessionById.get(r.session_id);
    if (!session) continue;
    counted.add(r.activity_id);
    planned += credit(session.credits);
  }
  const earned = [...attended.values()].reduce((sum, n) => sum + n, 0);
  return { earned, planned, total: earned + planned };
}

/** Posiciones de la progresión visual: una por sello hasta el último rango. El total real se informa aparte, nunca se recorta. */
export type StampSlot = 'earned' | 'planned' | 'empty';
export function stampSlots(projection: Pick<StampProjection, 'earned' | 'planned'>, positions: number): { slots: StampSlot[]; overflow: number } {
  const earned = Math.min(projection.earned, positions);
  const planned = Math.min(projection.planned, positions - earned);
  const slots = Array.from({ length: positions }, (_, i): StampSlot => (i < earned ? 'earned' : i < earned + planned ? 'planned' : 'empty'));
  return { slots, overflow: Math.max(projection.earned + projection.planned - positions, 0) };
}
