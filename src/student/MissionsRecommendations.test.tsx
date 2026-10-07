import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { joinNames, recommendationReason } from '../lib/recommendationReason';
import type { RecommendedActivity, RecommendationsResult } from '../lib/recommendationsApi';
import type { Board, BoardSession } from '../lib/reservations';
import Missions from './Missions';

const m = vi.hoisted(() => ({ board: null as unknown, recs: vi.fn() }));

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
  fetchDivisions: vi.fn().mockResolvedValue([{ id: 'd', code: 'SALUD', name: 'Ciencias de la Salud' }]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: m.recs }));

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const session = (activity: string, title: string, startMs: number, over: Partial<BoardSession> = {}): BoardSession => ({
  id: `s-${activity}`, activity_id: activity, title, description: 'Descripción corta', division_id: 'd', starts_at: iso(startMs), ends_at: iso(startMs + HOUR / 2),
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (sessions: BoardSession[]): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions, reservations: [],
});
const rec = (activity: string, over: Partial<RecommendedActivity> = {}): RecommendedActivity => ({
  activity_id: activity, title: activity, description: '', division_id: 'd', division_name: 'Ciencias de la Salud', division_code: 'SALUD', related_careers: '',
  careers: [], already_attended: false, already_reserved: false, sessions: [], priority: 1, recommendation_type: 'exact_career',
  matched_careers: [{ career_id: 'c1', career_name: 'Médico Cirujano', preference: 1 }], matched_division: null, interest_priority: 1, has_open_session: true, ...over,
});
const result = (recommendations: RecommendedActivity[]): RecommendationsResult => ({ recommendations, interest_career_ids: [], attended_activity_ids: [] });

const sessions = [
  session('plain', 'Mercados financieros', 10 * 60_000),
  session('exact', 'Simulación clínica', 30 * 60_000),
  session('fallback', 'Odontología digital', 40 * 60_000),
  session('multi', 'Nutrición clínica', 50 * 60_000),
  session('done', 'Anatomía aplicada', 60 * 60_000, { attended: true }),
  session('mine', 'Urgencias', 70 * 60_000, { my_reservation_id: 'r1' }),
];
const recommendations = [
  rec('exact'),
  rec('multi', { matched_careers: [{ career_id: 'c1', career_name: 'Médico Cirujano', preference: 1 }, { career_id: 'c2', career_name: 'Nutrición', preference: 2 }] }),
  rec('mine', { already_reserved: true }),
  rec('fallback', { recommendation_type: 'same_division', matched_careers: [], matched_division: { division_id: 'd', division_name: 'Ciencias de la Salud', division_code: 'SALUD' }, interest_priority: 1 }),
  rec('done', { already_attended: true }),
];

const renderMissions = async (recs: RecommendationsResult | null = result(recommendations), list = sessions) => {
  m.board = board(list);
  m.recs.mockResolvedValue(recs);
  render(<MemoryRouter><Missions /></MemoryRouter>);
  await screen.findByRole('heading', { name: list[0].title });
};
const card = (title: string) => screen.getByRole('heading', { name: title }).closest('li') as HTMLElement;
const titles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

beforeEach(() => vi.clearAllMocks());

test('«Para ti» appears when there are recommendations and not when there are none', async () => {
  await renderMissions();
  expect(screen.getByRole('button', { name: 'Para ti' })).toBeInTheDocument();
});

test('without personalised recommendations the chip is absent and the catalogue works as usual', async () => {
  await renderMissions(result([]));
  expect(screen.queryByRole('button', { name: 'Para ti' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
  expect(titles()).toContain('Mercados financieros');
});

test('a null/failed recommendation call never breaks the screen', async () => {
  await renderMissions(null);
  expect(screen.queryByRole('button', { name: 'Para ti' })).not.toBeInTheDocument();
  expect(titles()).toHaveLength(6);
});

test('an exact match says WHY: «Para ti · Porque te interesa Médico Cirujano»', async () => {
  await renderMissions();
  const c = card('Simulación clínica');
  expect(within(c).getByText('Para ti')).toBeInTheDocument();
  expect(within(c).getByText('Porque te interesa Médico Cirujano')).toBeInTheDocument();
});

test('a same-division suggestion is NOT presented as a match for the career', async () => {
  await renderMissions();
  const c = card('Odontología digital');
  expect(within(c).getByText('También te puede interesar')).toBeInTheDocument();
  expect(within(c).getByText('Ciencias de la Salud', { selector: 'span' })).toBeInTheDocument();
  expect(within(c).queryByText(/Porque te interesa/)).not.toBeInTheDocument();
  expect(within(c).queryByText('Para ti')).not.toBeInTheDocument();
});

test('several matched careers appear once, in one natural sentence', async () => {
  await renderMissions();
  expect(screen.getAllByRole('heading', { name: 'Nutrición clínica' })).toHaveLength(1);
  expect(within(card('Nutrición clínica')).getByText('Porque te interesa Médico Cirujano y Nutrición')).toBeInTheDocument();
});

test('an attended recommendation shows «Explorado» and no pitch; a booked one shows «En tu ruta»', async () => {
  await renderMissions();
  const done = card('Anatomía aplicada');
  expect(within(done).getByText('Explorado')).toBeInTheDocument();
  expect(within(done).queryByText(/Porque te interesa/)).not.toBeInTheDocument();
  const mine = card('Urgencias');
  expect(within(mine).getByText('En tu ruta')).toBeInTheDocument();
  expect(within(mine).getByText('Reservada')).toBeInTheDocument(); // the reservation state itself is untouched
});

test('in «Todos» the recommendations come first in the order the server ranked them, attended ones go with the rest', async () => {
  await renderMissions();
  expect(titles()).toEqual(['Simulación clínica', 'Nutrición clínica', 'Urgencias', 'Odontología digital', 'Mercados financieros', 'Anatomía aplicada']);
});

test('«Para ti» shows only personalised recommendations and «Todos» brings everything back', async () => {
  await renderMissions();
  fireEvent.click(screen.getByRole('button', { name: 'Para ti' }));
  expect(titles()).not.toContain('Mercados financieros');
  expect(titles()).toEqual(expect.arrayContaining(['Simulación clínica', 'Odontología digital', 'Nutrición clínica']));
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
  expect(titles()).toContain('Mercados financieros');
  expect(titles()).toHaveLength(6);
});

test('very long career names stay inside the card (wrap / clamp), also on a phone', async () => {
  const long = 'Licenciatura en Ingeniería en Tecnologías de la Información e Inteligencia Artificial con énfasis en Ciberseguridad';
  await renderMissions(result([rec('exact', { matched_careers: [{ career_id: 'c', career_name: long, preference: 1 }] })]));
  const reason = within(card('Simulación clínica')).getByText(`Porque te interesa ${long}`);
  expect(reason.className).toMatch(/line-clamp-2/);
  expect(reason.className).toMatch(/break-words/);
});

test('the wording is human, never «IA» / algorithm marketing', async () => {
  await renderMissions();
  expect(document.body.textContent).not.toMatch(/\bIA\b|inteligen|algoritmo|recomendado por/i);
});

test('recommendationReason / joinNames (pure wording)', () => {
  expect(joinNames([])).toBe('');
  expect(joinNames(['A'])).toBe('A');
  expect(joinNames(['A', 'B'])).toBe('A y B');
  expect(joinNames(['A', 'B', 'C'])).toBe('A, B y C');
  expect(recommendationReason(rec('x'))).toMatchObject({ badge: 'Para ti', reason: 'Porque te interesa Médico Cirujano', kind: 'exact_career' });
  expect(recommendationReason(rec('x', { recommendation_type: 'same_division', matched_careers: [], matched_division: { division_id: 'd', division_name: 'Negocios', division_code: 'N' } })))
    .toMatchObject({ badge: 'También te puede interesar', reason: 'Negocios', kind: 'same_division' });
  // payloads from before the new contract are still treated as career matches
  const legacy = { ...rec('x'), recommendation_type: undefined, matched_careers: undefined, careers: [{ career_id: 'c', career_name: 'Derecho' }] } as RecommendedActivity;
  expect(recommendationReason(legacy).reason).toBe('Porque te interesa Derecho');
});
