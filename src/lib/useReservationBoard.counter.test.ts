import { expect, test } from 'vitest';
import { sessionState, type Board, type BoardSession, type MyReservation } from './reservations';
import { applyClock } from './useReservationBoard';

// active_reservation_count must follow the clock in an already open tab (no reload, no polling).
const START = Date.parse('2026-10-15T15:00:00Z');
const END = Date.parse('2026-10-15T15:30:00Z');
const at = (t: number) => t - Date.now(); // clock offset that makes `now` equal t

const session = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Taller', description: '', division_id: 'd', starts_at: new Date(START).toISOString(), ends_at: new Date(END).toISOString(),
  location: '', credits: 1, status: 'activa', capacity: 30, reserved: 0, remaining: 30, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: 'r', conflicts_with: [], tight_transfer_with: [], ...over,
});
const reservation = (over: Partial<MyReservation> = {}): MyReservation => ({
  id: 'r', session_id: 's', activity_id: 'a', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active', credits_granted: null, ...over,
});
const board = (count: number, r: MyReservation, sessions: BoardSession[] = [session()]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: count, travel_buffer_minutes: 10,
  sessions, reservations: [r],
});
const live = session({ started: true, in_progress: true });

test('A: a reservation that crosses ends_at releases one of the four active slots', () => {
  const next = applyClock(board(4, reservation({ derived_status: 'in_progress' }), [live]), at(END + 60_000));
  expect(next.reservations[0].derived_status).toBe('ended');
  expect(next.active_reservation_count).toBe(3);
});

test('A: running the clock again does not release the same reservation twice', () => {
  const once = applyClock(board(4, reservation({ derived_status: 'in_progress' }), [live]), at(END + 60_000));
  expect(applyClock(once, at(END + 120_000)).active_reservation_count).toBe(3);
});

test('B: active → in_progress does not change the counter', () => {
  const next = applyClock(board(4, reservation()), at(START + 60_000));
  expect(next.reservations[0].derived_status).toBe('in_progress');
  expect(next.active_reservation_count).toBe(4);
});

test('C: completed, expired and cancelled reservations never alter the counter', () => {
  for (const status of ['completed', 'expired', 'cancelled']) {
    const next = applyClock(board(3, reservation({ derived_status: status })), at(END + 60_000));
    expect(next.active_reservation_count).toBe(3);
  }
});

test('the counter never goes below zero', () => {
  const next = applyClock(board(0, reservation({ derived_status: 'in_progress' }), [live]), at(END + 60_000));
  expect(next.active_reservation_count).toBe(0);
});

test('D: with the counter updated, another valid session stops being “max” without a refresh', () => {
  const other = session({
    id: 'other', activity_id: 'a2', my_reservation_id: null,
    starts_at: new Date(END + 3_600_000).toISOString(), ends_at: new Date(END + 5_400_000).toISOString(),
  });
  const b = board(4, reservation({ derived_status: 'in_progress' }), [live, other]);
  expect(sessionState(b, other)).toBe('max');
  const next = applyClock(b, at(END + 60_000));
  expect(sessionState(next, next.sessions.find((s) => s.id === 'other')!)).toBe('available');
});

test('a conflict or tight transfer that pointed at a commitment that just ended is dropped locally', () => {
  const later = session({
    id: 'later', activity_id: 'a2', starts_at: new Date(END - 600_000).toISOString(), ends_at: new Date(END + 1_800_000).toISOString(),
    my_reservation_id: null, conflicts_with: ['r'], tight_transfer_with: ['r'],
  });
  const next = applyClock(board(1, reservation({ derived_status: 'in_progress' }), [live, later]), at(END + 60_000));
  const out = next.sessions.find((s) => s.id === 'later')!;
  expect(out.conflicts_with).toEqual([]);
  expect(out.tight_transfer_with).toEqual([]);
});
