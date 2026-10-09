import { expect, test } from 'vitest';
import { isSelectable, sessionState, type Board, type BoardSession, type MyReservation } from '../lib/reservations';
import { LIVE_JOINABLE, LIVE_ONLY, missionFooter, missionHeadline } from './MissionCard';

const slot = (over: Partial<BoardSession> = {}): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Misión', description: '', division_id: 'd', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:45:00Z',
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 5, remaining: 25, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (sessions: BoardSession[], over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10,
  sessions, reservations: [], ...over,
});
const held = (over: Partial<MyReservation> = {}): MyReservation => ({
  id: 'r-other', session_id: 'other', activity_id: 'z', status: 'vigente', created_at: '', ended_at: null, resolved: false,
  derived_status: 'active', credits_granted: null, ...over,
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

// ---- «En curso» never promises entry unless the existing rules let THIS student select a session in progress

const live = (over: Partial<BoardSession> = {}) => slot({ id: 'live', started: true, in_progress: true, ...over });
const footerOf = (b: Board) => missionFooter(b, b.sessions, null, null);

test('1. in progress with room and selectable → it says the student can book and enter now', () => {
  const b = board([live()]);
  expect(sessionState(b, b.sessions[0])).toBe('in_progress');
  expect(missionHeadline(b, b.sessions, null, null)).toEqual({ kind: 'live', label: 'En curso' });
  expect(footerOf(b)).toEqual({ text: LIVE_JOINABLE, tone: 'brand' });
});

test('2. in progress but full → still «En curso», never «Puedes entrar ahora»', () => {
  const b = board([live({ remaining: 0, reserved: 30 })]);
  expect(sessionState(b, b.sessions[0])).toBe('full');
  expect(missionHeadline(b, b.sessions, null, null)?.kind).toBe('live');
  expect(footerOf(b)).toEqual({ text: LIVE_ONLY, tone: 'muted' });
  expect(footerOf(b).text).not.toMatch(/Puedes/);
});

test.each([
  ['conflict', board([live({ conflicts_with: ['r-other'] })], { reservations: [held()], active_reservation_count: 1 })],
  ['same_workshop', board([live()], { reservations: [held({ activity_id: 'a' })], active_reservation_count: 1 })],
  ['max', board([live()], { active_reservation_count: 4 })],
  ['closed', board([live()], { window: 'closed' })],
] as const)('3. in progress but blocked by an existing rule (%s) → no promise of entry', (rule, b) => {
  expect(sessionState(b, b.sessions[0])).toBe(rule);
  expect(footerOf(b)).toEqual({ text: LIVE_ONLY, tone: 'muted' });
});

test('4. the promise is exactly isSelectable(sessionState()) — the selection rules are used as they are', () => {
  const cases = [
    board([live()]),
    board([live({ remaining: 0, reserved: 30 })]),
    board([live()], { active_reservation_count: 4 }),
    board([live({ remaining: 0, reserved: 30 }), live({ id: 'live2', remaining: 5 })]),
  ];
  for (const b of cases) {
    const selectable = b.sessions.some((s) => s.in_progress && isSelectable(sessionState(b, s, null)));
    expect(footerOf(b).text).toBe(selectable ? LIVE_JOINABLE : LIVE_ONLY);
  }
  // a second session in progress with room keeps the mission joinable even if another one is full
  expect(footerOf(cases[3]).text).toBe(LIVE_JOINABLE);
});

test('personal state still wins in the footer: my own slot, or completed', () => {
  const mine = live({ my_reservation_id: 'r1' });
  expect(missionFooter(board([mine]), [mine], null, 'En tu ruta').text).toMatch(/^Tu horario: /);
  expect(missionFooter(board([live()]), [live()], null, 'Explorado').text).toBe('¡Ya la completaste!');
});
