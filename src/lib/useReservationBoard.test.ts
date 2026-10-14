import { describe, expect, test } from 'vitest';
import type { Board, BoardSession, MyReservation } from './reservations';
import { applyClock, nextEnrollmentClose } from './useReservationBoard';

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

const OPEN = Date.parse('2026-10-15T14:45:00Z');

test('the student can browse before opening but cannot select a mission', () => {
  const b: Board = { ...board(), opens_at: new Date(OPEN).toISOString(), window: 'not_open', sessions: [session({ my_reservation_id: null })], reservations: [], active_reservation_count: 0 };
  const before = applyClock(b, OPEN - 1 - Date.now());
  expect(before.window).toBe('not_open');
  expect(before.sessions).toHaveLength(1);
  expect(before.sessions[0].title).toBe('Taller');
});

test('the reservation window unlocks at exactly 9:45 Cancun on October 15 without a board reload', () => {
  const b: Board = { ...board(), opens_at: new Date(OPEN).toISOString(), window: 'not_open', sessions: [session({ my_reservation_id: null })], reservations: [], active_reservation_count: 0 };
  expect(applyClock(b, OPEN - 1 - Date.now()).window).toBe('not_open');
  const next = applyClock(b, OPEN - Date.now());
  expect(next.window).toBe('open');
  expect(next.sessions).toHaveLength(1);
  expect(applyClock(next, OPEN + 60_000 - Date.now()).window).toBe('open');
});

test('an explicitly configured closure also updates on an already open screen', () => {
  const b: Board = { ...board(), opens_at: new Date(OPEN).toISOString(), closes_at: new Date(OPEN + 3_600_000).toISOString() };
  expect(applyClock(b, OPEN + 3_600_000 - 1 - Date.now()).window).toBe('open');
  expect(applyClock(b, OPEN + 3_600_000 - Date.now()).window).toBe('closed');
});

describe('enrollment close follows the clock', () => {
  // Official examples: a session starting at 10:00 Cancún (15:00Z) closes enrollment at 10:05 / 10:10 / 10:20.
  const CASES = [{ minutes: 15, tolerance: 5 }, { minutes: 30, tolerance: 10 }, { minutes: 60, tolerance: 20 }];
  const sessionOf = (minutes: number, tolerance: number, over: Partial<BoardSession> = {}) => session({
    ends_at: new Date(START + minutes * 60_000).toISOString(),
    enrollment_closes_at: new Date(START + tolerance * 60_000).toISOString(),
    enrollment_open: true, my_reservation_id: null, ...over,
  });
  const boardOf = (s: BoardSession): Board => ({ ...board(), sessions: [s], reservations: [], active_reservation_count: 0 });
  const at = (b: Board, ms: number) => applyClock(b, ms - Date.now());

  test.each(CASES)('$minutes min: open before, at the start and exactly at +$tolerance min; closed one millisecond later', ({ minutes, tolerance }) => {
    const b = boardOf(sessionOf(minutes, tolerance));
    expect(at(b, START - 60_000).sessions[0].enrollment_open).toBe(true);
    expect(at(b, START).sessions[0].enrollment_open).toBe(true);
    expect(at(b, START + (tolerance * 60_000) / 2).sessions[0].enrollment_open).toBe(true);
    expect(at(b, START + tolerance * 60_000).sessions[0].enrollment_open).toBe(true);
    const closed = at(b, START + tolerance * 60_000 + 1);
    expect(closed.sessions[0].enrollment_open).toBe(false);
    // The session is still running; only NEW enrollment closed.
    expect(closed.sessions[0]).toMatchObject({ started: true, ended: false, in_progress: true });
  });

  test('an existing reservation is untouched when enrollment closes', () => {
    const s = sessionOf(30, 10, { my_reservation_id: 'r' });
    const b: Board = { ...board(reservation()), sessions: [s] };
    const closed = at(b, START + 10 * 60_000 + 1);
    expect(closed.sessions[0].my_reservation_id).toBe('r');
    expect(closed.reservations[0]).toMatchObject({ status: 'vigente', derived_status: 'in_progress' });
    expect(closed.active_reservation_count).toBe(b.active_reservation_count);
  });

  test('enrollment state is derived from the (server-offset) clock, not trusted from a stale snapshot', () => {
    const b = boardOf(sessionOf(15, 5, { enrollment_open: false }));
    expect(at(b, START - 3_600_000).sessions[0].enrollment_open).toBe(true); // a stale `false` is corrected from the clock
    const skewed = applyClock(boardOf(sessionOf(15, 5)), START + 5 * 60_000 + 1 - Date.now());
    expect(skewed.sessions[0].enrollment_open).toBe(false);
  });

  test('a payload without the field is left alone', () => {
    const b = boardOf(session({ my_reservation_id: null }));
    expect(at(b, START + 3_600_000).sessions[0]).not.toHaveProperty('enrollment_open');
  });

  test('nextEnrollmentClose picks the nearest future limit among open sessions', () => {
    const b: Board = { ...board(), sessions: [
      sessionOf(60, 20, { id: 'a' }), sessionOf(15, 5, { id: 'b' }), sessionOf(30, 10, { id: 'c', enrollment_open: false }),
      sessionOf(15, 5, { id: 'd', status: 'cancelada' }),
    ] };
    expect(nextEnrollmentClose(b, START)).toBe(START + 5 * 60_000);
    expect(nextEnrollmentClose(b, START + 5 * 60_000 + 1)).toBe(START + 20 * 60_000);
    expect(nextEnrollmentClose(b, START + 20 * 60_000 + 1)).toBeNull();
  });
});
