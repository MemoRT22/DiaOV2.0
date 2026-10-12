import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession } from '../lib/reservations';
import Missions from './Missions';

const m = vi.hoisted(() => ({ board: null as unknown, reserve: vi.fn(), change: vi.fn(), cancel: vi.fn(), reload: vi.fn() }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: { colors: { secondary: '#888888' }, divisions: {} },
    term: (key: string) => (key === 'route' ? 'Mi ruta' : key === 'activity' ? 'Talleres' : key),
    text: () => '',
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: m.reload, reserve: m.reserve, change: m.change, cancel: m.cancel }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchDivisions: vi.fn().mockResolvedValue([
    { id: 'salud', code: 'SALUD', name: 'Ciencias de la Salud' },
    { id: 'negocios', code: 'NEG', name: 'Negocios' },
  ]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: vi.fn(), subscribeParticipantChanges: () => () => {} }));

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const session = (id: string, activity: string, title: string, over: Partial<BoardSession>): BoardSession => ({
  id, activity_id: activity, title, description: 'Descripción', division_id: null, division_ids: [], starts_at: iso(HOUR), ends_at: iso(2 * HOUR),
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], activity_type: 'academica', experience_category: null, ...over,
});
const life = (category: string | null) => ({ activity_type: 'vida_universitaria', experience_category: category });
const board = (sessions: BoardSession[], over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions, reservations: [], ...over,
});

const CATALOGUE = [
  session('a1', 'acad', 'Taller de medicina', { division_id: 'salud', division_ids: ['salud'] }),
  // an academic workshop that has no division at all is still NOT Vida Universitaria
  session('a2', 'acad-sin-division', 'Taller académico sin división', {}),
  // Vida Universitaria: no division, several sessions of the same activity, different experience categories
  session('v1', 'futbol', 'Torneo relámpago', life('deportiva')),
  session('v1b', 'futbol', 'Torneo relámpago', { ...life('deportiva'), starts_at: iso(3 * HOUR), ends_at: iso(4 * HOUR) }),
  session('v2', 'debate', 'Club de debate', life('liderazgo')),
  session('v3', 'mural', 'Mural colectivo', life('artistica_cultural')),
  session('v4', 'feria', 'Feria de grupos estudiantiles', life('vida_universitaria')),
  // a Vida Universitaria activity that DOES have a division (test data): the type decides, not the division
  session('v5', 'demo', 'Experiencia con división', { ...life('otra'), division_id: 'negocios', division_ids: ['negocios'] }),
];

function Where() {
  return <output aria-label="url">{useLocation().search}</output>;
}
const show = async (sessions = CATALOGUE, entry = '/misiones', over: Partial<Board> = {}) => {
  m.board = board(sessions, over);
  render(<MemoryRouter initialEntries={[entry]}><Missions /><Where /></MemoryRouter>);
  await screen.findByRole('group', { name: 'Filtrar misiones' });
};
const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const filters = () => within(screen.getByRole('group', { name: 'Filtrar misiones' }));
const kinds = () => within(screen.getByRole('group', { name: 'Tipo de experiencia' }));
const LIFE = ['Torneo relámpago', 'Club de debate', 'Mural colectivo', 'Feria de grupos estudiantiles', 'Experiencia con división'];

beforeEach(() => vi.clearAllMocks());

test('Vida Universitaria is a first-class filter, placed before the divisions', async () => {
  await show();
  const names = filters().getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['Todos', 'Vida Universitaria', 'Ciencias de la Salud', 'Negocios']);
  expect(filters().getByRole('button', { name: 'Vida Universitaria' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('group', { name: 'Tipo de experiencia' })).not.toBeInTheDocument();
});

test('one tap shows every Vida Universitaria mission and no academic workshop', async () => {
  await show();
  expect(titles()).toHaveLength(7);
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  expect(filters().getByRole('button', { name: 'Vida Universitaria' })).toHaveAttribute('aria-pressed', 'true');
  expect(titles().sort()).toEqual([...LIFE].sort());
  expect(titles()).not.toContain('Taller de medicina');
  // not having a division does not make an academic workshop Vida Universitaria
  expect(titles()).not.toContain('Taller académico sin división');
});

test('it works for missions without a division, with a division, and with several sessions (one card each)', async () => {
  await show();
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  expect(titles().filter((t) => t === 'Torneo relámpago')).toHaveLength(1);
  expect(titles()).toContain('Feria de grupos estudiantiles');
  expect(titles()).toContain('Experiencia con división');
  // and the same activity still shows under its division
  fireEvent.click(filters().getByRole('button', { name: 'Negocios' }));
  expect(titles()).toEqual(['Experiencia con división']);
});

test('the kinds of experience appear only inside Vida Universitaria, only those with missions, and narrow the list', async () => {
  await show();
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  expect(kinds().getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Todas', 'Liderazgo', 'Deportiva', 'Artística y cultural', 'Vida Universitaria', 'Otras experiencias']);
  expect(kinds().getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(kinds().getByRole('button', { name: 'Deportiva' }));
  expect(titles()).toEqual(['Torneo relámpago']);
  expect(kinds().getByRole('button', { name: 'Deportiva' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(kinds().getByRole('button', { name: 'Liderazgo' }));
  expect(titles()).toEqual(['Club de debate']);
  fireEvent.click(kinds().getByRole('button', { name: 'Artística y cultural' }));
  expect(titles()).toEqual(['Mural colectivo']);
  fireEvent.click(kinds().getByRole('button', { name: 'Vida Universitaria' }));
  expect(titles()).toEqual(['Feria de grupos estudiantiles']);
  fireEvent.click(kinds().getByRole('button', { name: 'Otras experiencias' }));
  expect(titles()).toEqual(['Experiencia con división']);
  fireEvent.click(kinds().getByRole('button', { name: 'Todas' }));
  expect(titles().sort()).toEqual([...LIFE].sort());

  // leaving Vida Universitaria hides the kinds and restores the catalogue
  fireEvent.click(filters().getByRole('button', { name: 'Todos' }));
  expect(screen.queryByRole('group', { name: 'Tipo de experiencia' })).not.toBeInTheDocument();
  expect(titles()).toHaveLength(7);
});

test('the filter lives in the URL, so a link or the back button restores it', async () => {
  await show(CATALOGUE, '/misiones?f=life&c=deportiva');
  expect(titles()).toEqual(['Torneo relámpago']);
  expect(kinds().getByRole('button', { name: 'Deportiva' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(kinds().getByRole('button', { name: 'Liderazgo' }));
  expect(screen.getByLabelText('url')).toHaveTextContent('?f=life&c=liderazgo');
  fireEvent.click(filters().getByRole('button', { name: 'Ciencias de la Salud' }));
  expect(screen.getByLabelText('url')).toHaveTextContent('?f=division&d=salud');
});

test('a category without missions falls back to all of Vida Universitaria; no Vida Universitaria at all falls back to «Todos»', async () => {
  await show(CATALOGUE.filter((s) => s.activity_id !== 'futbol'), '/misiones?f=life&c=deportiva');
  expect(titles()).toHaveLength(4);
  expect(kinds().queryByRole('button', { name: 'Deportiva' })).not.toBeInTheDocument();
});

test('without Vida Universitaria missions there is no such filter', async () => {
  await show(CATALOGUE.filter((s) => s.activity_type === 'academica'), '/misiones?f=life');
  expect(filters().queryByRole('button', { name: 'Vida Universitaria' })).not.toBeInTheDocument();
  expect(titles()).toEqual(['Taller de medicina', 'Taller académico sin división']);
});

test('with a single kind of experience there is nothing to sub-filter', async () => {
  await show(CATALOGUE.filter((s) => s.activity_type === 'academica' || s.experience_category === 'deportiva'));
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  expect(titles()).toEqual(['Torneo relámpago']);
  expect(screen.queryByRole('group', { name: 'Tipo de experiencia' })).not.toBeInTheDocument();
});

test('changing filters never reserves, cancels or reloads anything, and keeps my reservations', async () => {
  const mine = CATALOGUE.map((s) => (s.id === 'v2' ? { ...s, my_reservation_id: 'r-1' } : s));
  await show(mine, '/misiones', { active_reservation_count: 1, reservations: [{ id: 'r-1', session_id: 'v2', activity_id: 'debate', status: 'vigente', created_at: iso(0), ended_at: null, resolved: false, derived_status: 'active', credits_granted: null }] });
  const snapshot = JSON.stringify(m.board);
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  fireEvent.click(kinds().getByRole('button', { name: 'Liderazgo' }));
  expect(within(screen.getByRole('heading', { level: 2, name: 'Club de debate' }).closest('li')!).getByText('En tu ruta')).toBeInTheDocument();
  fireEvent.click(kinds().getByRole('button', { name: 'Deportiva' }));
  fireEvent.click(filters().getByRole('button', { name: 'Negocios' }));
  fireEvent.click(filters().getByRole('button', { name: 'Todos' }));
  expect(m.reserve).not.toHaveBeenCalled();
  expect(m.change).not.toHaveBeenCalled();
  expect(m.cancel).not.toHaveBeenCalled();
  expect(m.reload).not.toHaveBeenCalled();
  expect(JSON.stringify(m.board)).toBe(snapshot);
  expect(titles()).toHaveLength(7);
});

test('each card says what the mission is: the experience for Vida Universitaria, the division for academic ones', async () => {
  await show();
  const card = (title: string) => within(screen.getByRole('heading', { level: 2, name: title }).closest('li')!);
  expect(card('Torneo relámpago').getByText('Vida Universitaria · Deportiva')).toBeInTheDocument();
  expect(card('Feria de grupos estudiantiles').getByText('Vida Universitaria')).toBeInTheDocument();
  expect(card('Experiencia con división').getByText('Vida Universitaria · Otras experiencias')).toBeInTheDocument();
  expect(card('Taller de medicina').getByText('Ciencias de la Salud')).toBeInTheDocument();
  expect(card('Taller académico sin división').getByText('Taller académico')).toBeInTheDocument();
});

test('the pre-catalogue type «liderazgo» is offered under Vida Universitaria · Liderazgo', async () => {
  await show([...CATALOGUE.filter((s) => s.activity_type === 'academica'),
    session('l1', 'viejo', 'Taller de liderazgo (prueba)', { activity_type: 'liderazgo', division_id: 'salud', division_ids: ['salud'] })]);
  fireEvent.click(filters().getByRole('button', { name: 'Vida Universitaria' }));
  expect(titles()).toEqual(['Taller de liderazgo (prueba)']);
});

test('a backend that does not report the type yet shows no Vida Universitaria filter instead of guessing', async () => {
  const untyped = CATALOGUE.map(({ activity_type: _t, experience_category: _c, ...rest }) => rest as BoardSession);
  await show(untyped);
  expect(filters().queryByRole('button', { name: 'Vida Universitaria' })).not.toBeInTheDocument();
  expect(titles()).toHaveLength(7);
});
