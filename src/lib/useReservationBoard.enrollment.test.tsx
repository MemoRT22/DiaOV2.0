import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession } from './reservations';
import { useReservationBoard } from './useReservationBoard';

const m = vi.hoisted(() => ({ fetchBoard: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, realtime: { setAuth: vi.fn() }, removeChannel: vi.fn() },
}));
vi.mock('./reservations', async (importOriginal) => ({ ...(await importOriginal<typeof import('./reservations')>()), fetchBoard: m.fetchBoard }));
vi.mock('./participantSync', () => ({ announceParticipantChange: vi.fn(), subscribeParticipantChanges: () => () => {} }));

// 10:00 Cancún = 15:00Z. 15/30/60-minute workshops admit new reservations until 10:05:00 / 10:10:00 / 10:20:00.
const START = Date.parse('2026-10-15T15:00:00Z');
const CASES = [{ minutes: 15, tolerance: 5 }, { minutes: 30, tolerance: 10 }, { minutes: 60, tolerance: 20 }];

const session = (minutes: number, tolerance: number): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Taller', description: '', division_id: 'd', starts_at: new Date(START).toISOString(),
  ends_at: new Date(START + minutes * 60_000).toISOString(), enrollment_closes_at: new Date(START + tolerance * 60_000).toISOString(), enrollment_open: true,
  location: '', credits: 1, status: 'activa', capacity: 30, reserved: 0, remaining: 30, started: true, ended: false, in_progress: true,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [],
});
const board = (serverNow: number, minutes: number, tolerance: number): Board => ({
  server_time: new Date(serverNow).toISOString(), window: 'open', opens_at: null, closes_at: null, max_reservations: 4,
  active_reservation_count: 0, travel_buffer_minutes: 10, sessions: [session(minutes, tolerance)], reservations: [],
});

beforeEach(() => { m.fetchBoard.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test.each(CASES)('$minutes min: a screen left open stops offering the session exactly after +$tolerance min, without reloading', async ({ minutes, tolerance }) => {
  const closes = START + tolerance * 60_000;
  vi.setSystemTime(closes - 60_000); // one minute before the limit
  m.fetchBoard.mockResolvedValue(board(closes - 60_000, minutes, tolerance));
  const { result } = renderHook(() => useReservationBoard('ed'));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.board?.sessions[0].enrollment_open).toBe(true);

  await act(async () => { await vi.advanceTimersByTimeAsync(59_000); }); // limit - 1 s
  expect(result.current.board?.sessions[0].enrollment_open).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); }); // the limit exactly: still open
  expect(result.current.board?.sessions[0].enrollment_open).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); }); // just after
  expect(result.current.board?.sessions[0].enrollment_open).toBe(false);
  expect(m.fetchBoard).toHaveBeenCalledTimes(1); // purely clock-driven: no extra request
});

test('the closing time follows the SERVER clock when the phone clock is wrong', async () => {
  const closes = START + 10 * 60_000;
  vi.setSystemTime(closes - 60_000 - 3_600_000); // phone is one hour behind
  m.fetchBoard.mockResolvedValue(board(closes - 60_000, 30, 10)); // server says 10:09:00
  const { result } = renderHook(() => useReservationBoard('ed'));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.board?.sessions[0].enrollment_open).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
  expect(result.current.board?.sessions[0].enrollment_open).toBe(false);
});
