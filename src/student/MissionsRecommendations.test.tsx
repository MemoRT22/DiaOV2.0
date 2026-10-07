import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { joinNames, recommendationReason } from '../lib/recommendationReason';
import type { RecommendedActivity, RecommendationsResult } from '../lib/recommendationsApi';
import type { Board, BoardSession } from '../lib/reservations';
import Missions from './Missions';

const m = vi.hoisted(() => ({
  board: null as unknown,
  recs: vi.fn(),
  reserve: vi.fn(),
  announce: vi.fn(),
  listeners: [] as Array<(kind: string) => void>,
}));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: { colors: { secondary: '#888888' }, divisions: {} },
    term: (key: string) => (key === 'route' ? 'Mi ruta' : key === 'activity' ? 'Talleres' : key),
    text: () => '',
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: vi.fn(), reserve: m.reserve, change: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchDivisions: vi.fn().mockResolvedValue([{ id: 'd', code: 'SALUD', name: 'Ciencias de la Salud' }]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: m.recs }));
vi.mock('../lib/participantSync', () => ({
  announceParticipantChange: m.announce,
  subscribeParticipantChanges: (cb: (kind: string) => void) => {
    m.listeners.push(cb);
    return () => { m.listeners = m.listeners.filter((l) => l !== cb); };
  },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  m.listeners = [];
  m.reserve.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

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

// ---------------------------------------------------------------------------------------------------------------
// Recommendations stay in sync with the personal state (same tab, other tabs, returning to the tab)
// ---------------------------------------------------------------------------------------------------------------
const reservedSnapshot = (reservedIds: string[], attendedIds: string[] = []) =>
  result(recommendations.map((r) => ({ ...r, already_reserved: reservedIds.includes(r.activity_id), already_attended: attendedIds.includes(r.activity_id) })));

async function mountWith(...snapshots: Array<RecommendationsResult | Error>) {
  m.board = board(sessions);
  m.recs.mockReset();
  snapshots.forEach((s) => (s instanceof Error ? m.recs.mockRejectedValueOnce(s) : m.recs.mockResolvedValueOnce(s)));
  m.recs.mockResolvedValue(snapshots[snapshots.length - 1] instanceof Error ? snapshots.find((x) => !(x instanceof Error)) : snapshots[snapshots.length - 1]);
  render(<MemoryRouter><Missions /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Mercados financieros' });
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(1));
}

/** Another tab announced a change: the screen re-queries after the (coalescing) debounce. */
async function otherTabAnnounces(kind: 'reservation' | 'attendance') {
  vi.useFakeTimers();
  act(() => m.listeners.forEach((l) => l(kind)));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  vi.useRealTimers();
}

test('A. booking from this screen re-queries the ranking: the card turns into «En tu ruta» without reloading the page', async () => {
  await mountWith(reservedSnapshot([]), reservedSnapshot(['exact']));
  const c = card('Simulación clínica');
  expect(within(c).queryByText('En tu ruta')).not.toBeInTheDocument();
  expect(within(c).getByText('Porque te interesa Médico Cirujano')).toBeInTheDocument();

  fireEvent.click(within(c).getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  await screen.findByRole('dialog', { name: 'Listo. Lo agregamos a tu ruta.' });

  expect(m.reserve).toHaveBeenCalledWith('s-exact');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  expect(await within(card('Simulación clínica')).findByText('En tu ruta')).toBeInTheDocument();
  expect(m.announce).not.toHaveBeenCalled(); // announcing is the board's job on a successful action, never the reload's
});

test('B. a failed booking is not treated as success: no re-query, the reason is shown', async () => {
  m.reserve.mockRejectedValue(new Error('SESSION_FULL'));
  await mountWith(reservedSnapshot([]));
  fireEvent.click(within(card('Simulación clínica')).getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/llenarse/);
  expect(m.recs).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Listo. Lo agregamos a tu ruta.')).not.toBeInTheDocument();
});

test('a failing re-query after a CONFIRMED booking does not turn it into a failed booking', async () => {
  await mountWith(reservedSnapshot([]), new Error('offline'));
  fireEvent.click(within(card('Simulación clínica')).getByRole('button', { name: 'Reservar' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Reservar lugar' })).getByRole('button', { name: 'Reservar' }));
  expect(await screen.findByRole('dialog', { name: 'Listo. Lo agregamos a tu ruta.' })).toBeInTheDocument();
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // and the last good ranking is still on screen
  expect(within(card('Simulación clínica')).getByText('Porque te interesa Médico Cirujano')).toBeInTheDocument();
});

test('C. another tab reserves or cancels → the ranking is re-queried', async () => {
  await mountWith(reservedSnapshot([]), reservedSnapshot(['exact']));
  expect(within(card('Simulación clínica')).queryByText('En tu ruta')).not.toBeInTheDocument();
  await otherTabAnnounces('reservation');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  expect(await within(card('Simulación clínica')).findByText('En tu ruta')).toBeInTheDocument();
});

test('D. another tab registers attendance → the ranking is re-queried and the card becomes «Explorado» without a manual refresh', async () => {
  await mountWith(reservedSnapshot([]), reservedSnapshot([], ['exact']));
  expect(within(card('Simulación clínica')).queryByText('Explorado')).not.toBeInTheDocument();
  await otherTabAnnounces('attendance');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  expect(await within(card('Simulación clínica')).findByText('Explorado')).toBeInTheDocument();
});

test('E. a failing re-query keeps the last good snapshot: the personalisation does not vanish and Talleres keeps working', async () => {
  await mountWith(reservedSnapshot([]), new Error('offline'));
  await otherTabAnnounces('reservation');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Para ti' })).toBeInTheDocument();
  expect(within(card('Simulación clínica')).getByText('Porque te interesa Médico Cirujano')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
  expect(titles()).toHaveLength(6);
});

test('an initial failure of the recommender never breaks Talleres', async () => {
  m.board = board(sessions);
  m.recs.mockReset();
  m.recs.mockRejectedValue(new Error('rpc down'));
  render(<MemoryRouter><Missions /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Mercados financieros' });
  expect(titles()).toHaveLength(6);
  expect(screen.queryByRole('button', { name: 'Para ti' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('F. re-querying the ranking never announces a change (no loops)', async () => {
  await mountWith(reservedSnapshot([]), reservedSnapshot(['exact']), reservedSnapshot(['exact']));
  await otherTabAnnounces('reservation');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(2));
  await otherTabAnnounces('attendance');
  await waitFor(() => expect(m.recs).toHaveBeenCalledTimes(3));
  expect(m.announce).not.toHaveBeenCalled();
});

test('coming back to the tab after a long time hidden re-queries once; a quick flip does nothing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
  m.board = board(sessions);
  m.recs.mockReset();
  m.recs.mockResolvedValue(reservedSnapshot([]));
  render(<MemoryRouter><Missions /></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(m.recs).toHaveBeenCalledTimes(1);
  const visibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  visibility('hidden');
  vi.setSystemTime(new Date('2026-10-15T15:00:04Z'));
  visibility('visible');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(m.recs).toHaveBeenCalledTimes(1);
  visibility('hidden');
  vi.setSystemTime(new Date('2026-10-15T15:01:00Z'));
  visibility('visible');
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(m.recs).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); }); // no polling
  expect(m.recs).toHaveBeenCalledTimes(2);
});
