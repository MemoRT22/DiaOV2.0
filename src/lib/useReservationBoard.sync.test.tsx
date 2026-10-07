import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board } from './reservations';
import { useReservationBoard } from './useReservationBoard';

const m = vi.hoisted(() => ({
  fetchBoard: vi.fn(),
  reserveSession: vi.fn(),
  changeReservation: vi.fn(),
  cancelReservation: vi.fn(),
  announce: vi.fn(),
  listeners: [] as Array<(kind: string) => void>,
}));

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, realtime: { setAuth: vi.fn() }, removeChannel: vi.fn() },
}));
vi.mock('./reservations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reservations')>()),
  fetchBoard: m.fetchBoard,
  reserveSession: m.reserveSession,
  changeReservation: m.changeReservation,
  cancelReservation: m.cancelReservation,
}));
vi.mock('./participantSync', () => ({
  announceParticipantChange: m.announce,
  subscribeParticipantChanges: (cb: (kind: string) => void) => {
    m.listeners.push(cb);
    return () => { m.listeners = m.listeners.filter((l) => l !== cb); };
  },
}));

const board = (count: number): Board => ({
  server_time: new Date().toISOString(), window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: count,
  travel_buffer_minutes: 10, sessions: [], reservations: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  m.listeners = [];
  m.fetchBoard.mockResolvedValue(board(1));
  m.reserveSession.mockResolvedValue({});
  m.changeReservation.mockResolvedValue({});
  m.cancelReservation.mockResolvedValue({});
});

test('F: a reservation change announced by another tab reloads the board', async () => {
  const { result } = renderHook(() => useReservationBoard('ed'));
  await waitFor(() => expect(result.current.board?.active_reservation_count).toBe(1));
  expect(m.fetchBoard).toHaveBeenCalledTimes(1);

  m.fetchBoard.mockResolvedValue(board(2));
  vi.useFakeTimers();
  act(() => m.listeners[0]('reservation'));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  vi.useRealTimers();
  await waitFor(() => expect(result.current.board?.active_reservation_count).toBe(2));
  expect(m.fetchBoard).toHaveBeenCalledTimes(2);
  // G: the reload caused by an announcement is silent
  expect(m.announce).not.toHaveBeenCalled();
});

test('a successful reserve, change and cancel are announced once each, after the server accepted them', async () => {
  const { result } = renderHook(() => useReservationBoard('ed'));
  await waitFor(() => expect(result.current.board).not.toBeNull());
  await act(async () => { await result.current.reserve('s1'); });
  await act(async () => { await result.current.change('r1', 's2'); });
  await act(async () => { await result.current.cancel('r1'); });
  expect(m.announce).toHaveBeenCalledTimes(3);
  expect(m.announce).toHaveBeenCalledWith('reservation');
});

test('H: a failed action is not announced as a change (but the board is still refreshed for this tab)', async () => {
  m.reserveSession.mockRejectedValue(new Error('SESSION_FULL'));
  const { result } = renderHook(() => useReservationBoard('ed'));
  await waitFor(() => expect(result.current.board).not.toBeNull());
  const before = m.fetchBoard.mock.calls.length;
  await act(async () => { await expect(result.current.reserve('s1')).rejects.toThrow('SESSION_FULL'); });
  expect(m.announce).not.toHaveBeenCalled();
  expect(m.fetchBoard.mock.calls.length).toBe(before + 1);
});

test('the tab that performs the action reloads exactly once (no double reload from its own announcement)', async () => {
  const { result } = renderHook(() => useReservationBoard('ed'));
  await waitFor(() => expect(result.current.board).not.toBeNull());
  const before = m.fetchBoard.mock.calls.length;
  await act(async () => { await result.current.reserve('s1'); });
  expect(m.fetchBoard.mock.calls.length).toBe(before + 1);
});
