import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession } from '../lib/reservations';
import Missions from './Missions';

const m = vi.hoisted(() => ({ board: null as unknown, recs: null as unknown }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: { colors: { secondary: '#888888', accent: '#8b3dff' }, divisions: {} },
    term: (key: string) => key,
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
    { id: 'vacia', code: 'VAC', name: 'Área sin misiones' },
  ]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: vi.fn(async () => m.recs) }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: vi.fn(), subscribeParticipantChanges: () => () => {} }));

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const session = (id: string, activity: string, title: string, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: activity, title, description: 'Descripción', division_id: null, division_ids: [], starts_at: iso(HOUR), ends_at: iso(2 * HOUR),
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], activity_type: 'academica', experience_category: null, ...over,
});
const CATALOGUE = [
  session('s1', 'medicina', 'Urgencias médicas', { division_id: 'salud', division_ids: ['salud'], description: 'Atiende una emergencia simulada.', location: 'Negocios 3109' }),
  session('s2', 'nutricion', 'Nutrición deportiva', { division_id: 'salud', division_ids: ['salud'] }),
  session('n1', 'mercado', 'Marketing Rush', { division_id: 'negocios', division_ids: ['negocios'] }),
  session('n1b', 'mercado', 'Marketing Rush', { division_id: 'negocios', division_ids: ['negocios'], starts_at: iso(3 * HOUR), ends_at: iso(4 * HOUR) }),
  session('v1', 'danza', 'Danza Urbana', { activity_type: 'vida_universitaria', experience_category: 'artistica_cultural' }),
  session('v2', 'futbol', 'Torneo relámpago', { activity_type: 'vida_universitaria', experience_category: 'deportiva', started: true, in_progress: true, starts_at: iso(-HOUR / 4) }),
];
const board = (sessions: BoardSession[]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions, reservations: [],
});

function Where() {
  return <output aria-label="url">{useLocation().search}</output>;
}
const show = async (entry = '/misiones', sessions = CATALOGUE) => {
  m.board = board(sessions);
  render(<MemoryRouter initialEntries={[entry]}><Missions /><Where /></MemoryRouter>);
  await screen.findByRole('searchbox', { name: 'Buscar misión' });
};
const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  m.recs = null;
});

test('the starting point is a landing of areas, not 63 cards in a row', async () => {
  await show();
  const areas = screen.getByRole('region', { name: 'Explora por área' });
  expect(within(areas).getByRole('link', { name: /Ciencias de la Salud/ })).toHaveTextContent('2 misiones');
  expect(within(areas).getByRole('link', { name: /Negocios/ })).toHaveTextContent('1 misión');
  expect(within(areas).getByRole('link', { name: /Vida Universitaria/ })).toHaveTextContent('2 misiones');
  // an area without missions is not offered
  expect(within(areas).queryByText('Área sin misiones')).not.toBeInTheDocument();
  // no mission cards yet: they live one tap away
  expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  expect(screen.queryByText('Marketing Rush')).not.toBeInTheDocument();
  expect(within(areas).getByRole('link', { name: /Ver las 5 misiones/ })).toHaveAttribute('href', '/misiones?f=all');
});

test('every tile leads to the same filters the list already had', async () => {
  await show();
  const areas = screen.getByRole('region', { name: 'Explora por área' });
  expect(within(areas).getByRole('link', { name: /Ciencias de la Salud/ })).toHaveAttribute('href', '/misiones?f=division&d=salud');
  expect(within(areas).getByRole('link', { name: /Vida Universitaria/ })).toHaveAttribute('href', '/misiones?f=life');
  fireEvent.click(within(areas).getByRole('link', { name: /Negocios/ }));
  expect(await screen.findByText('Marketing Rush')).toBeInTheDocument();
  expect(titles()).toEqual(['Marketing Rush']);
  expect(screen.getByText('1 misión', { selector: 'p' })).toBeInTheDocument();
  // and «Áreas» takes the student back to the landing
  fireEvent.click(screen.getByRole('button', { name: 'Áreas' }));
  expect(await screen.findByRole('region', { name: 'Explora por área' })).toBeInTheDocument();
  expect(screen.getByLabelText('url')).toHaveTextContent('');
});

test('«En curso ahora» is announced on the landing only when something is really running', async () => {
  await show();
  expect(screen.getByRole('link', { name: /En curso ahora/ })).toHaveAttribute('href', '/misiones?f=live');
  document.body.innerHTML = '';
  await show('/misiones', CATALOGUE.filter((s) => !s.in_progress));
  expect(screen.queryByRole('link', { name: /En curso ahora/ })).not.toBeInTheDocument();
});

test('«En curso ahora» only describes what is running, and says how many of those the student can really book', async () => {
  await show();
  // one running mission with room and an open window: bookable under the existing rules
  expect(screen.getByRole('link', { name: /En curso ahora/ })).toHaveTextContent('1 misión en curso · 1 acepta reservación ahora');
  document.body.innerHTML = '';
  // the same mission once its enrollment tolerance is over: still running, but it no longer promises anything
  await show('/misiones', CATALOGUE.map((s) => (s.in_progress ? { ...s, enrollment_open: false } : s)));
  const live = screen.getByRole('link', { name: /En curso ahora/ });
  expect(live).toHaveTextContent('1 misión en curso · revisa cuáles aún aceptan reservación');
  expect(live).not.toHaveTextContent(/aún puedes entrar/);
});

test('the search box describes the search that exists: name, topic or room (careers are not indexed, so it does not promise them)', async () => {
  await show();
  const box = screen.getByRole('searchbox', { name: 'Buscar misión' });
  expect(box).toHaveAttribute('placeholder', 'Busca por nombre, tema o salón');
  expect(box.getAttribute('placeholder')).not.toMatch(/carrera/i);
  fireEvent.change(box, { target: { value: 'zzz' } });
  expect(await screen.findByText(/un tema, el área o el nombre del salón/)).toBeInTheDocument();
  expect(screen.queryByText(/carrera/i)).not.toBeInTheDocument();
});

test('«Para ti» is featured only when the server really recommends something', async () => {
  await show();
  expect(screen.queryByRole('region', { name: 'Misiones para ti' })).not.toBeInTheDocument();
  document.body.innerHTML = '';
  m.recs = { recommendations: [{ activity_id: 'medicina', title: 'Urgencias médicas', recommendation_type: 'exact_career', matched_careers: [{ career_id: 'c', career_name: 'Médico Cirujano', preference: 1 }], already_attended: false, already_reserved: false }] };
  await show();
  const featured = await screen.findByRole('region', { name: 'Misiones para ti' });
  expect(within(featured).getByRole('heading', { name: 'Urgencias médicas' })).toBeInTheDocument();
  expect(within(featured).getAllByText('Para ti').length).toBeGreaterThan(0);
});

test('search finds a concrete mission without accents or exact words, and clears back to the landing', async () => {
  await show();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar misión' }), { target: { value: 'NUTRICION' } });
  expect(await screen.findByRole('heading', { name: 'Nutrición deportiva' })).toBeInTheDocument();
  expect(titles()).toEqual(['Nutrición deportiva']);
  expect(screen.getByText('1 resultado para «NUTRICION»')).toBeInTheDocument();
  // the place and the concept are searchable too, and every word must match
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar misión' }), { target: { value: 'emergencia 3109' } });
  expect(titles()).toEqual(['Urgencias médicas']);
  // the area name counts as well
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar misión' }), { target: { value: 'vida universitaria' } });
  expect(titles()).toEqual(['Danza Urbana', 'Torneo relámpago']);
  fireEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
  expect(await screen.findByRole('region', { name: 'Explora por área' })).toBeInTheDocument();
});

test('a search with no match says so and offers a way out; the full list is still reachable', async () => {
  await show('/misiones?q=zzz');
  expect(await screen.findByText('No encontramos «zzz»')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
  fireEvent.click(await screen.findByRole('link', { name: /Ver las 5 misiones/ }));
  expect(await screen.findAllByRole('heading', { level: 2 })).toHaveLength(5);
});

test('changing a reservation skips the landing and the search: it goes straight to the list', async () => {
  m.board = {
    ...board(CATALOGUE),
    active_reservation_count: 1,
    reservations: [{ id: 'r1', session_id: 'n1', activity_id: 'mercado', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active', credits_granted: null }],
  };
  render(<MemoryRouter initialEntries={['/misiones?cambiar=r1']}><Missions /></MemoryRouter>);
  await screen.findAllByRole('heading', { level: 2 });
  expect(screen.queryByRole('region', { name: 'Explora por área' })).not.toBeInTheDocument();
  expect(screen.queryByRole('searchbox', { name: 'Buscar misión' })).not.toBeInTheDocument();
});

const REC = (activity_id: string) => ({ activity_id, title: activity_id, recommendation_type: 'exact_career', matched_careers: [{ career_id: 'c', career_name: 'Médico Cirujano', preference: 1 }], already_attended: false, already_reserved: false });

test('the landing opens with the whole universe: a real count in the title, areas first and «Para ti» after them', async () => {
  m.recs = { recommendations: [REC('medicina')] };
  await show();
  expect(screen.getByText('5 misiones por descubrir')).toBeInTheDocument(); // 5 real missions in the catalogue (6 sessions)
  const areas = screen.getByRole('region', { name: 'Explora por área' });
  const forYou = await screen.findByRole('region', { name: 'Misiones para ti' });
  // «Explora por área» comes BEFORE «Para ti» in the page
  expect(areas.compareDocumentPosition(forYou) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // the route is one compact control in the title row, not a row of its own
  expect(screen.getByRole('link', { name: 'Mi ruta: 0 de 4 misiones reservadas' })).toHaveTextContent('0/4');
});

test('«Para ti» is a row that slides and ends in a door to somewhere ELSE, with real numbers', async () => {
  m.recs = { recommendations: [REC('medicina'), REC('nutricion')] };
  await show();
  const forYou = await screen.findByRole('region', { name: 'Misiones para ti' });
  // compact cards: name, state and one tap target; no description paragraphs
  expect(within(forYou).getByRole('heading', { name: 'Urgencias médicas' })).toBeInTheDocument();
  expect(within(forYou).getAllByRole('link', { name: 'Ver misión' })).toHaveLength(2); // one tap target per card
  expect(within(forYou).queryByText('Atiende una emergencia simulada.')).not.toBeInTheDocument();
  // both recommended missions are Salud, so the door leads to the biggest area they do NOT touch: Negocios (1 mission)
  const door = within(forYou).getByRole('link', { name: /Y también…/ });
  expect(door).toHaveAttribute('href', '/misiones?f=division&d=negocios');
  expect(door).toHaveTextContent('Negocios');
  expect(door).toHaveTextContent('1 misión fuera de tus sugerencias');
});

test('with no area left outside the suggestions the door simply opens the whole catalogue', async () => {
  m.recs = { recommendations: [REC('medicina'), REC('mercado')] }; // Salud and Negocios both have a suggestion
  await show();
  const forYou = await screen.findByRole('region', { name: 'Misiones para ti' });
  const door = within(forYou).getByRole('link', { name: /Y también…/ });
  expect(door).toHaveAttribute('href', '/misiones?f=all');
  expect(door).toHaveTextContent('Todas las misiones');
  expect(door).toHaveTextContent('5 misiones');
});

test('«Ver las N» sits with the areas it summarises and keeps its destination', async () => {
  await show();
  const areas = screen.getByRole('region', { name: 'Explora por área' });
  expect(within(areas).getByRole('link', { name: 'Ver las 5 misiones' })).toHaveAttribute('href', '/misiones?f=all');
});
