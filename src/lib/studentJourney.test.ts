import { describe, expect, test } from 'vitest';
import type { Board, BoardSession, MyReservation } from './reservations';
import { buildJourney, firstName, focusStop, isImminent, timingLabel } from './studentJourney';

const T = (hhmm: string, day = '2026-10-15') => `${day}T${hhmm}:00-05:00`; // Cancún time
const at = (hhmm: string, day = '2026-10-15') => new Date(T(hhmm, day)).getTime();

const session = (id: string, start: string, end: string, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: `a-${id}`, title: `Taller ${id}`, description: '', division_id: 'd', starts_at: T(start), ends_at: T(end), location: 'Salón',
  credits: 1, status: 'activa', capacity: 30, reserved: 0, remaining: 30, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const res = (id: string, sessionId: string, derived: string, over: Partial<MyReservation> = {}): MyReservation => ({
  id, session_id: sessionId, activity_id: `a-${sessionId}`, status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: derived,
  credits_granted: null, ...over,
});
const board = (sessions: BoardSession[], reservations: MyReservation[]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions, reservations,
});

describe('buildJourney', () => {
  const b = board(
    [session('1', '09:00', '09:30'), session('2', '09:45', '10:15'), session('3', '10:30', '11:00'), session('4', '11:15', '11:45'), session('5', '12:00', '12:30')],
    [res('r4', '4', 'active'), res('r2', '2', 'in_progress'), res('r1', '1', 'completed'), res('r3', '3', 'active'), res('r5', '5', 'ended')],
  );
  const j = buildJourney(b);

  test('separates now, upcoming, pending, done and closed — chronologically', () => {
    expect(j.now.map((s) => s.reservation.id)).toEqual(['r2']);
    expect(j.upcoming.map((s) => s.reservation.id)).toEqual(['r3', 'r4']);
    expect(j.pending.map((s) => s.reservation.id)).toEqual(['r5']);
    expect(j.done.map((s) => s.reservation.id)).toEqual(['r1']);
    expect(j.closed).toEqual([]);
  });

  test('the focus is what is happening now, else the next upcoming one, else nothing', () => {
    expect(focusStop(j)).toMatchObject({ kind: 'now', stop: { reservation: { id: 'r2' } } });
    expect(focusStop({ ...j, now: [] })).toMatchObject({ kind: 'next', stop: { reservation: { id: 'r3' } } });
    expect(focusStop({ ...j, now: [], upcoming: [] })).toBeNull();
  });

  test('cancelled and archived reservations go to history, resolved cancellations are dropped', () => {
    const closed = buildJourney(board([session('9', '09:00', '09:30')], [res('x', '9', 'cancelled', { status: 'cancelada_sesion', resolved: false })]));
    expect(closed.closed).toHaveLength(1);
    const dropped = buildJourney(board([session('9', '09:00', '09:30')], [res('x', '9', 'cancelled', { status: 'cancelada_sesion', resolved: true })]));
    expect(dropped.closed).toHaveLength(0);
  });
});

describe('timingLabel', () => {
  const s = { starts_at: T('10:30'), ends_at: T('11:00') };
  test('counts down to the start', () => {
    expect(timingLabel(s, at('10:18'))).toBe('Empieza en 12 min');
    expect(timingLabel(s, at('09:30'))).toBe('Empieza en 1 h');
    expect(timingLabel(s, at('10:29'))).toBe('Empieza en 1 min');
  });
  test('says it is in progress and when it ends', () => {
    expect(timingLabel(s, at('10:45'))).toBe('En curso · termina en 15 min');
  });
  test('far away today it just says the time; another day it says the date', () => {
    expect(timingLabel(s, at('07:00'))).toBe('Hoy a las 10:30');
    expect(timingLabel(s, at('10:00', '2026-10-14'))).toMatch(/15 oct.* · 10:30/);
  });
  test('after the end it says it ended', () => {
    expect(timingLabel(s, at('11:10'))).toBe('Terminó a las 11:00');
  });
});

test('imminent = in progress or starting within 15 minutes', () => {
  const s = { starts_at: T('10:30'), ends_at: T('11:00') };
  expect(isImminent(s, at('10:20'))).toBe(true);
  expect(isImminent(s, at('10:40'))).toBe(true);
  expect(isImminent(s, at('09:00'))).toBe(false);
  expect(isImminent(s, at('11:30'))).toBe(false);
});

test('firstName', () => {
  expect(firstName('  Ana María López ')).toBe('Ana');
  expect(firstName('')).toBe('');
  expect(firstName(undefined)).toBe('');
});
