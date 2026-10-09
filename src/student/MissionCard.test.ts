import { expect, test } from 'vitest';
import type { Board, BoardSession } from '../lib/reservations';
import { missionHeadline } from './MissionCard';

const slot = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Misión', description: '', division_id: 'd', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:45:00Z',
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 5, remaining: 25, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (sessions: BoardSession[]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10,
  sessions, reservations: [],
});
const headline = (sessions: BoardSession[], personal: 'Explorado' | 'En tu ruta' | null = null) =>
  missionHeadline(board(sessions), sessions, null, personal);

test('one headline per mission card, personal state first', () => {
  expect(headline([slot()], 'Explorado')).toEqual({ kind: 'done', label: 'Completada' });
  expect(headline([slot({ in_progress: true })], 'En tu ruta')).toEqual({ kind: 'in_route', label: 'En tu ruta' });
  expect(headline([slot({ in_progress: true })])).toEqual({ kind: 'live', label: 'En curso' });
});

test('a mission is «Llena» only when every session that has not ended is full', () => {
  expect(headline([slot({ remaining: 0, reserved: 30 }), slot({ id: 'old', ended: true })])).toEqual({ kind: 'full', label: 'Llena' });
  expect(headline([slot({ remaining: 0, reserved: 30 }), slot({ id: 'b' })])).toBeNull();
});

test('«Pocos lugares» when every open slot is almost full; a plain open mission has no pill', () => {
  expect(headline([slot({ remaining: 2, reserved: 28 })])).toEqual({ kind: 'few', label: 'Pocos lugares' });
  expect(headline([slot()])).toBeNull();
});
