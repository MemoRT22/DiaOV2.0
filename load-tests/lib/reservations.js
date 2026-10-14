import { conflictAccepted, duplicateReservation, maxExceeded, overbooking, reserveConflict, reserveDuplicateRejected, reserveFull, reserveMax, reserveSuccess } from './metrics.js';
import { pick } from './think.js';

const startsMs = (session) => Date.parse(session.starts_at);
const endsMs = (session) => Date.parse(session.ends_at);
export const overlaps = (a, b) => startsMs(a) < endsMs(b) && startsMs(b) < endsMs(a);

/** Sesiones del tablero que esta persona ya tiene reservadas y vigentes (aún no terminan). */
export function myActive(board) {
  const byId = new Map(board.sessions.map((s) => [s.id, s]));
  return board.reservations
    .filter((r) => r.status === 'vigente' && byId.has(r.session_id) && !byId.get(r.session_id).ended)
    .map((r) => ({ reservation: r, session: byId.get(r.session_id) }));
}

/**
 * Comprueba en el tablero que la persona ve el estado correcto: ninguna sesión con más reservados que cupo, ningún cupo negativo,
 * ninguna sesión reservada dos veces, ningún taller reservado en dos horarios y no más reservaciones que el máximo.
 */
export function auditBoard(board) {
  for (const s of board.sessions) {
    if (s.reserved > s.capacity || s.remaining < 0) overbooking.add(1, { session: s.id });
  }
  const active = myActive(board);
  const sessions = new Set();
  const activities = new Set();
  for (const { session } of active) {
    if (sessions.has(session.id) || activities.has(session.activity_id)) duplicateReservation.add(1);
    sessions.add(session.id); activities.add(session.activity_id);
  }
  if (active.length > board.max_reservations) maxExceeded.add(1);
  // Dos reservaciones vigentes que se solapan en el tiempo = un conflicto que el sistema dejó pasar.
  for (let i = 0; i < active.length; i += 1) for (let j = i + 1; j < active.length; j += 1) if (overlaps(active[i].session, active[j].session)) conflictAccepted.add(1);
}

/** Clasifica el resultado de `reserve_session` en las métricas de negocio. `hot` etiqueta el éxito con la sesión para el tope de cupo. */
export function accountReserve(result, session, hot) {
  if (result.ok) { reserveSuccess.add(1, hot ? { session: session.id } : {}); return 'ok'; }
  switch (result.code) {
    case 'SESSION_FULL': reserveFull.add(1); break;
    case 'SCHEDULE_CONFLICT': case 'SAME_WORKSHOP': reserveConflict.add(1); break;
    case 'ALREADY_RESERVED': reserveDuplicateRejected.add(1); break;
    case 'MAX_RESERVATIONS': reserveMax.add(1); break;
    default: break;
  }
  return result.code;
}

/** Sesiones candidatas para esta persona (sin conflicto, sin repetir taller). `fresh` = solo las que el tablero muestra con lugar. */
export function candidates(board, pool, fresh) {
  const active = myActive(board);
  const mine = new Set(board.reservations.filter((r) => r.status === 'vigente').map((r) => r.session_id));
  const boardById = new Map(board.sessions.map((s) => [s.id, s]));
  return pool.map((p) => boardById.get(p.id)).filter(Boolean).filter((s) => !s.ended && !s.attended && !mine.has(s.id) && (!fresh || s.remaining > 0)
    && !active.some((a) => a.session.activity_id === s.activity_id || overlaps(a.session, s)));
}

/** Sesiones que SÍ chocan con algo que la persona ya tiene (para provocar y comprobar el rechazo). */
export function conflicting(board, pool) {
  const active = myActive(board);
  const mine = new Set(board.reservations.filter((r) => r.status === 'vigente').map((r) => r.session_id));
  const boardById = new Map(board.sessions.map((s) => [s.id, s]));
  return pool.map((p) => boardById.get(p.id)).filter(Boolean)
    .filter((s) => !s.ended && !mine.has(s.id) && active.some((a) => a.session.activity_id === s.activity_id || overlaps(a.session, s)));
}
export { pick };
