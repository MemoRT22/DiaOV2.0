import { describe, expect, test } from 'vitest';
import {
  canModify,
  hasTightTransfer,
  holdsWorkshop,
  isSelectable,
  sessionState,
  type Board,
  type BoardSession,
  type MyReservation,
} from './reservations';

const session = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's1', activity_id: 'a1', title: 'Taller', description: '', division_id: 'd', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z',
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 0, remaining: 30, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});

const reservation = (over: Partial<MyReservation> = {}): MyReservation => ({
  id: 'r1', session_id: 's1', activity_id: 'a1', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active',
  credits_granted: null, ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10,
  sessions: [], reservations: [], ...over,
});

describe('sessions in progress', () => {
  test('a session that already started but has not ended with room is reservable', () => {
    const s = session({ started: true, in_progress: true });
    const state = sessionState(board(), s);
    expect(state).toBe('in_progress');
    expect(isSelectable(state)).toBe(true);
  });

  test('a session that ended is not reservable', () => {
    const state = sessionState(board(), session({ started: true, ended: true }));
    expect(state).toBe('ended');
    expect(isSelectable(state)).toBe(false);
  });

  test('a full session in progress stays blocked', () => {
    expect(sessionState(board(), session({ started: true, in_progress: true, remaining: 0 }))).toBe('full');
  });

  test('the personal maximum still blocks an in-progress session', () => {
    expect(sessionState(board({ active_reservation_count: 4 }), session({ started: true, in_progress: true }))).toBe('max');
  });

  test('global reservation window still blocks new reservations', () => {
    expect(sessionState(board({ window: 'closed' }), session({ in_progress: true, started: true }))).toBe('closed');
  });
});

describe('schedule rules', () => {
  test('a real overlap blocks', () => {
    const state = sessionState(board(), session({ conflicts_with: ['r9'] }));
    expect(state).toBe('conflict');
    expect(isSelectable(state)).toBe(false);
  });

  test('a tight transfer is only a warning and stays selectable', () => {
    const s = session({ tight_transfer_with: ['r9'] });
    expect(hasTightTransfer(s)).toBe(true);
    expect(isSelectable(sessionState(board(), s))).toBe(true);
  });

  test('the reservation being replaced is ignored for conflicts and warnings', () => {
    const replacing = reservation({ id: 'r9' });
    expect(sessionState(board(), session({ conflicts_with: ['r9'] }), replacing)).toBe('available');
    expect(hasTightTransfer(session({ tight_transfer_with: ['r9'] }), replacing)).toBe(false);
  });
});

describe('same workshop', () => {
  test('is held while the first session has not ended, including in progress', () => {
    const held = reservation({ derived_status: 'in_progress' });
    expect(holdsWorkshop(held)).toBe(true);
    expect(sessionState(board({ reservations: [held] }), session({ id: 's2' }))).toBe('same_workshop');
  });

  test('is released once the first session ended without attendance', () => {
    const ended = reservation({ derived_status: 'ended' });
    expect(holdsWorkshop(ended)).toBe(false);
    expect(isSelectable(sessionState(board({ reservations: [ended] }), session({ id: 's2' })))).toBe(true);
  });
});

describe('cancel and change', () => {
  test('a session in progress can still be cancelled and changed', () => {
    const allowed = canModify(board(), session({ started: true, in_progress: true }), reservation({ derived_status: 'in_progress' }));
    expect(allowed).toEqual({ cancel: true, change: true });
  });

  test('after the reservation window closes only cancelling remains', () => {
    expect(canModify(board({ window: 'closed' }), session(), reservation())).toEqual({ cancel: true, change: false });
  });

  test('neither is offered once the session ended or attendance is registered', () => {
    expect(canModify(board(), session({ ended: true }), reservation({ derived_status: 'ended' }))).toEqual({ cancel: false, change: false });
    expect(canModify(board(), session({ attended: true }), reservation({ derived_status: 'completed' }))).toEqual({ cancel: false, change: false });
  });
});
