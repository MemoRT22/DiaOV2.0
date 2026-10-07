import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { belongsToDivision, type Board, type BoardSession } from '../lib/reservations';
import Missions from './Missions';

const m = vi.hoisted(() => ({ board: null as unknown }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: { colors: { secondary: '#888888' }, divisions: {} },
    term: (key: string) => (key === 'route' ? 'Mi ruta' : key === 'activity' ? 'Talleres' : key),
    text: () => '',
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: vi.fn(), reserve: vi.fn(), change: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchDivisions: vi.fn().mockResolvedValue([
    { id: 'salud', code: 'SALUD', name: 'Ciencias de la Salud' },
    { id: 'negocios', code: 'NEG', name: 'Negocios' },
    { id: 'derecho', code: 'DER', name: 'Derecho' },
  ]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: vi.fn(), subscribeParticipantChanges: () => () => {} }));

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const session = (activity: string, title: string, over: Partial<BoardSession>): BoardSession => ({
  id: `s-${activity}`, activity_id: activity, title, description: 'Descripción', division_id: null, starts_at: iso(HOUR), ends_at: iso(2 * HOUR),
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (sessions: BoardSession[]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions, reservations: [],
});

const sessions = [
  session('single', 'Una división', { division_id: 'salud', division_ids: ['salud'] }),
  // several related divisions: the legacy singular column stays NULL, the relation lives in division_ids
  session('multi', 'Varias divisiones', { division_id: null, division_ids: ['salud', 'negocios'] }),
  // legacy activity: only the singular column, and a payload without division_ids
  session('legacy', 'Solo legacy', { division_id: 'derecho' }),
  session('other', 'Otra división', { division_id: 'negocios', division_ids: ['negocios'] }),
];

const show = async () => {
  m.board = board(sessions);
  render(<MemoryRouter><Missions /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Una división' });
};
const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const pick = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => vi.clearAllMocks());

test('a workshop with one division appears in that division', async () => {
  await show();
  pick('Ciencias de la Salud');
  expect(titles()).toContain('Una división');
});

test('a multi-division workshop appears when ANY of its related divisions is selected', async () => {
  await show();
  pick('Ciencias de la Salud');
  expect(titles()).toContain('Varias divisiones');
  pick('Negocios');
  expect(titles()).toContain('Varias divisiones');
});

test('a workshop does not appear under a division it does not belong to', async () => {
  await show();
  pick('Ciencias de la Salud');
  expect(titles()).not.toContain('Otra división');
  expect(titles()).not.toContain('Solo legacy');
  pick('Derecho');
  expect(titles()).toEqual(['Solo legacy']);
});

test('a legacy activity with only division_id keeps working', async () => {
  await show();
  pick('Derecho');
  expect(titles()).toContain('Solo legacy');
});

test('«Todos» still lists everything', async () => {
  await show();
  pick('Negocios');
  pick('Todos');
  expect(titles()).toHaveLength(4);
});

test('belongsToDivision: division_ids, legacy division_id, none', () => {
  expect(belongsToDivision({ division_id: null, division_ids: ['a', 'b'] }, 'b')).toBe(true);
  expect(belongsToDivision({ division_id: 'a' }, 'a')).toBe(true);
  expect(belongsToDivision({ division_id: 'a', division_ids: [] }, 'a')).toBe(true);
  expect(belongsToDivision({ division_id: 'a', division_ids: ['a'] }, 'c')).toBe(false);
  expect(belongsToDivision({ division_id: null, division_ids: [] }, 'a')).toBe(false);
});
