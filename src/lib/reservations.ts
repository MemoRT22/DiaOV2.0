import { rpc } from './adminApi';
import type { SessionStatus } from './catalog';

export type ReservationWindow = 'not_open' | 'open' | 'closed';
export type ReservationStatus = 'vigente' | 'cancelada_sesion' | 'expirada';
export type DerivedStatus = 'active' | 'in_progress' | 'completed' | 'ended' | 'expired' | 'cancelled' | string;

export type BoardSession = {
  id: string;
  activity_id: string;
  title: string;
  description: string;
  division_id: string | null;
  /** EVERY division the workshop belongs to (a workshop can relate to several; `division_id` is only the legacy singular one). */
  division_ids?: string[];
  starts_at: string;
  ends_at: string;
  location: string;
  credits: number;
  status: SessionStatus;
  capacity: number;
  reserved: number;
  remaining: number;
  started: boolean;
  ended: boolean;
  in_progress: boolean;
  attended: boolean;
  my_reservation_id: string | null;
  /** Own reservations that REALLY overlap this session in time (blocks). */
  conflicts_with: string[];
  /** Own reservations that do not overlap but leave less than `travel_buffer_minutes` between sessions (warning only). */
  tight_transfer_with: string[];
};

export type MyReservation = {
  id: string;
  session_id: string;
  activity_id: string;
  status: ReservationStatus;
  created_at: string;
  ended_at: string | null;
  resolved: boolean;
  derived_status: DerivedStatus;
  credits_granted: number | null;
};

export type Board = {
  server_time: string;
  window: ReservationWindow;
  opens_at: string | null;
  closes_at: string | null;
  max_reservations: number;
  active_reservation_count: number;
  /** Recommended (not enforced) minutes between sessions. */
  travel_buffer_minutes: number;
  /** Deprecated: no longer authorizes check-in. Kept in the payload for compatibility. */
  checkin_close_after_minutes?: number;
  sessions: BoardSession[];
  reservations: MyReservation[];
};

export type AvailabilityPatch = { session_id: string; reserved: number; remaining: number; full: boolean };

export const fetchBoard = () => rpc<Board>('my_reservation_board');
export const reserveSession = (sessionId: string) => rpc('reserve_session', { p_session: sessionId });
export const changeReservation = (reservationId: string, sessionId: string) =>
  rpc('change_reservation', { p_reservation: reservationId, p_session: sessionId });
export const cancelReservation = (reservationId: string) => rpc('cancel_reservation', { p_reservation: reservationId });

export const availabilityTopic = (editionId: string) => `availability:${editionId}`;

export function reservationWindow(openAt: string | null, closeAt: string | null, now = Date.now()): ReservationWindow {
  if (!openAt || now < new Date(openAt).getTime()) return 'not_open';
  if (closeAt && now >= new Date(closeAt).getTime()) return 'closed';
  return 'open';
}

export type SessionState =
  | 'reserved'
  | 'cancelled'
  | 'ended'
  | 'in_progress'
  | 'not_open'
  | 'closed'
  | 'full'
  | 'same_workshop'
  | 'conflict'
  | 'max'
  | 'few'
  | 'available'
  | 'already_attended';

const FEW_PLACES_RATIO = 0.15;

/**
 * A workshop belongs to a division when it is among ALL its related divisions (`division_ids`); the legacy singular
 * `division_id` still counts so older payloads and legacy activities keep working.
 */
export function belongsToDivision(s: Pick<BoardSession, 'division_id' | 'division_ids'>, divisionId: string): boolean {
  return !!s.division_ids?.includes(divisionId) || s.division_id === divisionId;
}

export function isFewPlaces(s: Pick<BoardSession, 'remaining' | 'capacity'>) {
  return s.remaining > 0 && s.remaining <= Math.max(3, Math.ceil(s.capacity * FEW_PLACES_RATIO));
}

/**
 * Commitment: counts toward the personal limit (`active_reservation_count`). A reservation stops being a commitment
 * once its session ends (derived_status `ended`) or when attendance is registered (`completed`).
 */
export function isActiveReservation(r: MyReservation): boolean {
  return r.status === 'vigente' && (r.derived_status === 'active' || r.derived_status === 'in_progress');
}

/**
 * The reservation still "owns" its workshop while its session has not ended: SAME_WORKSHOP applies until `ends_at`.
 * After that (without attendance) another session of the same workshop can be reserved; the old one stays as history.
 */
export function holdsWorkshop(r: MyReservation): boolean {
  return isActiveReservation(r);
}

/**
 * Preview of the server rules so the screen can explain why a session is not selectable.
 * The server re-checks everything; this never authorizes anything.
 * A session in progress is still joinable until it ends.
 */
export function sessionState(board: Board, s: BoardSession, replacing?: MyReservation | null): SessionState {
  if (s.status === 'cancelada') return 'cancelled';
  if (s.attended) return 'already_attended';
  if (s.my_reservation_id) return 'reserved';
  if (s.ended) return 'ended';
  if (board.window === 'not_open') return 'not_open';
  if (board.window === 'closed') return 'closed';
  if (s.remaining <= 0) return 'full';
  const holding = board.reservations.filter((r) => holdsWorkshop(r) && r.id !== replacing?.id);
  if (holding.some((r) => r.activity_id === s.activity_id)) return 'same_workshop';
  if (s.conflicts_with.some((id) => id !== replacing?.id)) return 'conflict';
  const activeCount = replacing
    ? board.active_reservation_count - (isActiveReservation(replacing) ? 1 : 0)
    : board.active_reservation_count;
  if (activeCount >= board.max_reservations) return 'max';
  if (s.in_progress) return 'in_progress';
  return isFewPlaces(s) ? 'few' : 'available';
}

export const isSelectable = (state: SessionState) => state === 'available' || state === 'few' || state === 'in_progress';

/** Tight transfer is a warning, never a block: the student may still reserve. */
export function hasTightTransfer(s: Pick<BoardSession, 'tight_transfer_with'>, replacing?: MyReservation | null): boolean {
  return s.tight_transfer_with.some((id) => id !== replacing?.id);
}

/**
 * Cancelling or changing is allowed while the session has not ended and no attendance was registered
 * (so a session in progress can still be left). Changing creates a new reservation, so it needs the global window open.
 */
export function canModify(board: Board, s: BoardSession, r: MyReservation) {
  const editable = isActiveReservation(r) && !s.ended && !s.attended;
  return { cancel: editable, change: editable && board.window === 'open' };
}

export function durationMinutes(s: Pick<BoardSession, 'starts_at' | 'ends_at'>) {
  return Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
}
