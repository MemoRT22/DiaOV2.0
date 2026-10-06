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
  division_id: string;
  starts_at: string;
  ends_at: string;
  location: string;
  credits: number;
  status: SessionStatus;
  capacity: number;
  reserved: number;
  remaining: number;
  started: boolean;
  attended: boolean;
  my_reservation_id: string | null;
  conflicts_with: string[];
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
  travel_buffer_minutes: number;
  checkin_close_after_minutes: number;
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

export type SessionCount = { session_id: string; capacity: number; reserved: number; remaining: number };

export async function fetchSessionCounts(): Promise<Map<string, number>> {
  const rows = await rpc<SessionCount[]>('session_reservation_counts');
  return new Map((rows ?? []).map((r) => [r.session_id, r.reserved]));
}

/** Coordinación only decides when reservations open and close; every other rule is defined by the system. */
export type ReservationSettings = {
  reservations_open_at: string | null;
  reservations_close_at: string | null;
};

export const updateReservationSettings = (p: ReservationSettings) => rpc('update_reservation_settings', { p });

export type SessionState =
  | 'reserved'
  | 'cancelled'
  | 'started'
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

export function isFewPlaces(s: Pick<BoardSession, 'remaining' | 'capacity'>) {
  return s.remaining > 0 && s.remaining <= Math.max(3, Math.ceil(s.capacity * FEW_PLACES_RATIO));
}

/**
 * Commitment: counts toward the personal limit (`active_reservation_count`) and toward schedule conflicts.
 * A session in progress is still a commitment even though it can no longer be modified.
 */
export function isActiveReservation(r: MyReservation): boolean {
  return r.status === 'vigente' && (r.derived_status === 'active' || r.derived_status === 'in_progress');
}

/**
 * The reservation still "owns" its workshop: SAME_WORKSHOP applies until the check-in window closes.
 * After `ends_at` it no longer counts toward the limit, but it may still produce a valid attendance
 * (derived_status `ended`), so another session of the same workshop cannot be reserved yet.
 */
export function holdsWorkshop(r: MyReservation): boolean {
  return isActiveReservation(r) || (r.status === 'vigente' && r.derived_status === 'ended');
}

/**
 * Preview of the server rules so the screen can explain why a session is not selectable.
 * The server re-checks everything; this never authorizes anything.
 */
export function sessionState(board: Board, s: BoardSession, replacing?: MyReservation | null): SessionState {
  if (s.status === 'cancelada') return 'cancelled';
  if (s.attended) return 'already_attended';
  if (s.my_reservation_id) return 'reserved';
  if (s.started) return 'started';
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
  return isFewPlaces(s) ? 'few' : 'available';
}

export const isSelectable = (state: SessionState) => state === 'available' || state === 'few';

/** Modifiable is narrower than committed: a session in progress still commits the student but cannot change. */
export function canModify(board: Board, s: BoardSession, r: MyReservation) {
  const editable = r.status === 'vigente' && !s.started && r.derived_status === 'active';
  return { cancel: editable, change: editable && board.window === 'open' };
}

export function durationMinutes(s: Pick<BoardSession, 'starts_at' | 'ends_at'>) {
  return Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
}
