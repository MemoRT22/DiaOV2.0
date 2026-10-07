import { expect, test } from 'vitest';
import type { Board, BoardSession, MyReservation } from './reservations';
import { applyClock } from './useReservationBoard';

const START = Date.parse('2026-10-15T15:00:00Z');
const END = Date.parse('2026-10-15T15:30:00Z');

const session = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Taller', description: '', division_id: 'd', starts_at: new Date(START).toISOString(), ends_at: new Date(END).toISOString(),
  location: '', credits: 1, status: 'activa', capacity: 30, reserved: 0, remaining: 30, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: 'r', conflicts_with: [], tight_transfer_with: [], ...over,
});
const reservation = (over: Partial<MyReservation> = {}): MyReservation => ({
  id: 'r', session_id: 's', activity_id: 'a', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active', credits_granted: null, ...over,
});
const board = (r: MyReservation = reservation()): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 1, travel_buffer_minutes: 10,
  sessions: [session()], reservations: [r],
});

test('before the session nothing changes', () => {
  const b = board();
  expect(applyClock(b, 0 - 0 + (START - 60_000 - Date.now()))).toBe(b);
});

test('once the session starts it is in progress and still modifiable', () => {
  const next = applyClock(board(), START + 60_000 - Date.now());
  expect(next.sessions[0]).toMatchObject({ started: true, ended: false, in_progress: true });
  expect(next.reservations[0].derived_status).toBe('in_progress');
});

test('once the session ends the reservation moves to “ended” (attendance can still be registered)', () => {
  const next = applyClock(board(reservation({ derived_status: 'in_progress' })), END + 60_000 - Date.now());
  expect(next.sessions[0]).toMatchObject({ started: true, ended: true, in_progress: false });
  expect(next.reservations[0].derived_status).toBe('ended');
});

test('completed, expired and cancelled reservations are never rewritten by the clock', () => {
  for (const status of ['completed', 'expired', 'cancelled']) {
    const b = board(reservation({ derived_status: status }));
    expect(applyClock(b, END + 60_000 - Date.now()).reservations[0].derived_status).toBe(status);
  }
});
