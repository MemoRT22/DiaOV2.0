import type { AvailabilityPatch, Board } from './reservations';

/**
 * `my_reservation_board` is the most expensive call of the platform and every student screen needs it. This keeps ONE copy in memory:
 *  - screens that mount while it is fresh reuse it (no request);
 *  - simultaneous requests share a single request;
 *  - a copy older than the TTL is still shown at once while it is revalidated in the background;
 *  - a confirmed change (reserve / change / cancel / attendance) or a sign-in/out invalidates it.
 * Only this browser tab's memory: nothing is persisted, and the server keeps validating every action.
 */
export const BOARD_TTL_MS = 20_000;

export type LoadedBoard = { board: Board; receivedAt: number };

let entry: LoadedBoard | null = null;
let inflight: Promise<LoadedBoard> | null = null;
let generation = 0;

/** What is held right now (any age), or null. */
export const peekBoard = (): LoadedBoard | null => entry;
export const boardIsFresh = (now = Date.now()): boolean => !!entry && now - entry.receivedAt < BOARD_TTL_MS;

export function loadBoard(load: () => Promise<Board>, force = false): Promise<LoadedBoard> {
  if (force) invalidateBoard();
  else if (boardIsFresh()) return Promise.resolve(entry as LoadedBoard);
  if (inflight) return inflight;
  const gen = generation;
  const request: Promise<LoadedBoard> = load()
    .then((board) => {
      const loaded = { board, receivedAt: Date.now() };
      if (gen === generation) entry = loaded;
      return loaded;
    })
    .finally(() => { if (inflight === request) inflight = null; });
  inflight = request;
  return request;
}

/** The held copy is no longer trustworthy (the student changed something, or the account changed). */
export function invalidateBoard(): void {
  entry = null;
  inflight = null;
  generation += 1;
}

/** Seat counts pushed by the availability broadcast also update the held copy, so a screen mounted later does not start with old numbers. */
export function patchBoardAvailability(p: AvailabilityPatch): void {
  if (!entry) return;
  entry = { ...entry, board: { ...entry.board, sessions: entry.board.sessions.map((s) => (s.id === p.session_id ? { ...s, reserved: p.reserved, remaining: p.remaining } : s)) } };
}

export const resetBoardCache = invalidateBoard;
