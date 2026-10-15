import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BOARD_TTL_MS, boardIsFresh, invalidateBoard, loadBoard, patchBoardAvailability, peekBoard } from './boardCache';
import type { Board } from './reservations';

const board = (n = 0): Board => ({ server_time: new Date().toISOString(), window: 'open', opens_at: null, closes_at: null, max_reservations: 4,
  active_reservation_count: n, travel_buffer_minutes: 10, sessions: [{ id: 's1', reserved: 1, remaining: 4 } as never], reservations: [] });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('simultaneous screens share ONE request', async () => {
  const load = vi.fn(async () => board(1));
  const [a, b, c] = await Promise.all([loadBoard(load), loadBoard(load), loadBoard(load)]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(a.board).toBe(b.board);
  expect(c.board.active_reservation_count).toBe(1);
});

test('a fresh copy is reused; after the TTL a new request is made', async () => {
  const load = vi.fn(async () => board());
  await loadBoard(load);
  await loadBoard(load);
  expect(load).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(BOARD_TTL_MS + 1);
  expect(boardIsFresh()).toBe(false);
  expect(peekBoard()).not.toBeNull(); // still available to show while it is revalidated
  await loadBoard(load);
  expect(load).toHaveBeenCalledTimes(2);
});

test('a forced load (confirmed change) always asks again and an old in-flight answer cannot overwrite it', async () => {
  let release: (b: Board) => void = () => undefined;
  const slow = vi.fn(() => new Promise<Board>((resolve) => { release = resolve; }));
  const first = loadBoard(slow);
  const fast = vi.fn(async () => board(5));
  const forced = await loadBoard(fast, true);
  release(board(1)); // the pre-change answer arrives late
  await first;
  expect(forced.board.active_reservation_count).toBe(5);
  expect(peekBoard()?.board.active_reservation_count).toBe(5);
});

test('invalidating drops the copy; availability patches update the held copy', async () => {
  await loadBoard(async () => board());
  patchBoardAvailability({ session_id: 's1', reserved: 4, remaining: 1, full: false });
  expect(peekBoard()?.board.sessions[0]).toMatchObject({ reserved: 4, remaining: 1 });
  invalidateBoard();
  expect(peekBoard()).toBeNull();
});

test('a failed request is not cached and the next one retries', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(board(2));
  await expect(loadBoard(load)).rejects.toThrow('boom');
  expect((await loadBoard(load)).board.active_reservation_count).toBe(2);
});
