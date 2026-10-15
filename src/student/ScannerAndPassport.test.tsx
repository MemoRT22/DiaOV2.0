import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CheckInResult } from '../lib/checkin';
import type { MyRaffleStatus } from '../lib/raffleRules';
import { neutralTheme } from '../theme/neutralTheme';
import PassportPage from './PassportPage';
import Scanner from './Scanner';
import { RafflePrizeProvider } from './RafflePrizeProvider';

const m = vi.hoisted(() => ({
  checkIn: vi.fn(),
  announce: vi.fn(),
  fetchProgress: vi.fn(),
  fetchDivisions: vi.fn(),
  fetchMyRaffleStatus: vi.fn(),
  fetchBoard: vi.fn(),
  fetchPrizes: vi.fn(),
  edition: { interests_prompt_at: null } as { interests_prompt_at: string | null },
  listeners: [] as Array<(kind: string) => void>,
}));

vi.mock('qr-scanner', () => ({ default: class { start = vi.fn(); stop = vi.fn(); destroy = vi.fn(); } }));
vi.mock('../lib/checkin', () => ({ checkIn: m.checkIn }));
vi.mock('../lib/participantSync', () => ({
  announceParticipantChange: m.announce,
  subscribeParticipantChanges: (cb: (kind: string) => void) => {
    m.listeners.push(cb);
    return () => { m.listeners = m.listeners.filter((l) => l !== cb); };
  },
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchProgress: m.fetchProgress,
  fetchDivisions: m.fetchDivisions,
}));
vi.mock('../lib/reservations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/reservations')>()),
  fetchBoard: m.fetchBoard,
}));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.fetchMyRaffleStatus }));
vi.mock('../lib/raffleWinner', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/raffleWinner')>()), fetchMyRafflePrizes: m.fetchPrizes }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Alumno E2E' }, signOut: vi.fn() }) }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: m.edition }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    term: (key: 'stamp' | 'division' | 'rank' | 'passport', plural = false) => (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));

const result = (over: Partial<CheckInResult> = {}): CheckInResult => ({
  already_registered: false, session_id: 's', activity_id: 'a', title: 'Taller E2E', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z',
  credits_granted: 1, method: 'codigo_manual', stamps: 4, attended_workshops: 3, level: 2, ...over,
});

const progress = (over: Record<string, unknown> = {}) => ({
  level: 1, stamps: 0, attended_workshops: 0, reserved_workshops: 0, division_ids: [], next: null, consent_accepted: true,
  post_event_interests_prompt: false, post_event_interests_open: false, post_event_interests_completed: false, ...over,
});

/** The official categories, as `my_raffle_status` returns them (lowest first). */
const CATEGORIES = [
  { id: 'ss', name: 'Sistema Solar', sort_order: 10, rules: [{ academic: 1, university_life: 1 }] },
  { id: 'ga', name: 'Galaxia', sort_order: 20, rules: [{ academic: 2, university_life: 1 }, { total: 4 }] },
  { id: 'un', name: 'Universo', sort_order: 30, rules: [{ academic: 3, university_life: 1 }, { academic: 2, university_life: 2 }] },
];

const raffle = (academic: number, universityLife: number, category: string | null = null, over: Partial<MyRaffleStatus> = {}): MyRaffleStatus => ({
  academic_stamps: academic, university_life_stamps: universityLife, total_stamps: academic + universityLife,
  raffle_category: CATEGORIES.find((c) => c.name === category)?.id ?? null, raffle_category_name: category,
  has_won: false, categories: CATEGORIES, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.listeners = [];
  m.edition = { interests_prompt_at: null };
  m.fetchDivisions.mockResolvedValue([]);
  m.fetchBoard.mockResolvedValue(null);
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(1, 0));
  m.fetchPrizes.mockResolvedValue({ prizes: [], pollSeconds: 600 });
});

async function scan(res: CheckInResult | Error) {
  if (res instanceof Error) m.checkIn.mockRejectedValue(res);
  else m.checkIn.mockResolvedValue(res);
  render(<MemoryRouter><Scanner /></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText('ABCDEF'), { target: { value: 'ABCDEF' } });
  fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
}

// ----------------------------------------------------------- Scanner (STUDENT-E2E-01)

test('A: a new check-in celebrates and shows the stamps gained', async () => {
  await scan(result());
  expect(await screen.findByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
  expect(screen.getByText('+1')).toBeInTheDocument();
  expect(screen.getByText('Taller E2E')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument(); // total stamps
  expect(screen.getByText('3')).toBeInTheDocument(); // attended workshops
  expect(screen.getByText(/2 · Rango 2/)).toBeInTheDocument();
});

test('a 60-minute mission is confirmed with +2 stamps', async () => {
  await scan(result({ credits_granted: 2, stamps: 2, attended_workshops: 1, ends_at: '2026-10-15T16:00:00Z' }));
  expect(await screen.findByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
  expect(screen.getByText('+2')).toBeInTheDocument();
  expect(screen.queryByText('+1')).not.toBeInTheDocument();
  expect(screen.getByText('Ya sumaste 2 sellos a tu bitácora.')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument(); // total stamps after ONE mission
  expect(screen.getByText('1')).toBeInTheDocument(); // attended missions
});

test('a mission of any other length is confirmed with +1 stamp, in singular', async () => {
  await scan(result({ credits_granted: 1, stamps: 3 }));
  await screen.findByRole('heading', { name: 'Misión completada' });
  expect(screen.getByText('+1')).toBeInTheDocument();
  expect(screen.getByText('Ya sumaste 1 sello a tu bitácora.')).toBeInTheDocument();
});

test('the confirmation shows the raffle category reached with this attendance', async () => {
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(2, 1, 'Galaxia'));
  await scan(result({ credits_granted: 2, stamps: 3 }));
  expect(await screen.findByText('Categoría Galaxia')).toBeInTheDocument();
  expect(screen.getByText(/2 académicos · 1 de Vida Universitaria/)).toBeInTheDocument();
  expect(screen.getByText(/Te falta 1 sello académico o 1 sello de Vida Universitaria para Universo\./)).toBeInTheDocument();
});

test('without a category yet, the confirmation says what is missing and never invents one', async () => {
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(2, 0));
  await scan(result({ credits_granted: 2, stamps: 2 }));
  expect(await screen.findByText('Aún sin categoría')).toBeInTheDocument();
  expect(screen.getByText(/Te falta 1 sello de Vida Universitaria para Galaxia\./)).toBeInTheDocument();
  expect(screen.queryByText(/^Categoría /)).not.toBeInTheDocument();
});

test('the check-in still succeeds on screen when the raffle status cannot be loaded', async () => {
  m.fetchMyRaffleStatus.mockRejectedValue(new Error('offline'));
  await scan(result({ credits_granted: 2, stamps: 2 }));
  expect(await screen.findByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
  expect(screen.getByText('+2')).toBeInTheDocument();
  expect(screen.queryByText('Sorteo')).not.toBeInTheDocument();
});

test('B: a repeated check-in is a successful, idempotent outcome that never shows +1', async () => {
  await scan(result({ already_registered: true }));
  expect(await screen.findByRole('heading', { name: 'Asistencia ya registrada' })).toBeInTheDocument();
  expect(screen.queryByText('+1')).not.toBeInTheDocument();
  expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ya sumaste/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Misión completada/)).not.toBeInTheDocument();
  expect(screen.getByText(/Esta asistencia ya estaba registrada\. Tus .+ no cambiaron\./)).toBeInTheDocument();
  // the real totals, rank and the registered workshop and time are still there
  expect(screen.getByText('Taller E2E')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText(/2 · Rango 2/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a new attendance is announced to other tabs; a repeated one and a failure are not', async () => {
  await scan(result());
  await screen.findByRole('heading', { name: 'Misión completada' });
  expect(m.announce).toHaveBeenCalledTimes(1);
  expect(m.announce).toHaveBeenCalledWith('attendance');
});

test('H: an idempotent check-in does not announce a change', async () => {
  await scan(result({ already_registered: true }));
  await screen.findByRole('heading', { name: 'Asistencia ya registrada' });
  expect(m.announce).not.toHaveBeenCalled();
});

test('H: a failed check-in is not announced as a change', async () => {
  await scan(new Error('NO_RESERVATION'));
  await screen.findByText(/No tienes reservación/);
  expect(m.announce).not.toHaveBeenCalled();
});

// ----------------------------------------------------------- Passport (STUDENT-E2E-02 / 03)

test('C: the Bitácora splits the stamps by kind and names the missing one in singular', async () => {
  m.fetchProgress.mockResolvedValue(progress({ stamps: 1, attended_workshops: 1 }));
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(1, 0));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  const card = within(await screen.findByRole('region', { name: 'Sorteo' }));
  expect(card.getByText('Aún no entras al sorteo.')).toBeInTheDocument();
  expect(card.getByText('Sellos académicos').nextElementSibling).toHaveTextContent('1');
  expect(card.getByText('Sellos de Vida Universitaria').nextElementSibling).toHaveTextContent('0');
  expect(card.getByText('Te falta 1 sello de Vida Universitaria para Sistema Solar.')).toBeInTheDocument();
});

test('D: plural — “2 sellos académicos”, and never the old «liderazgo» wording', async () => {
  m.fetchProgress.mockResolvedValue(progress({ stamps: 4, attended_workshops: 2 }));
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(0, 4, 'Galaxia'));
  const { container } = render(<MemoryRouter><PassportPage /></MemoryRouter>);
  const card = within(await screen.findByRole('region', { name: 'Sorteo' }));
  expect(card.getByText('Te faltan 2 sellos académicos para Universo.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/liderazgo|tickets|misiónes/i);
});

test('the Bitácora shows the category reached, its stamps and how every category is unlocked', async () => {
  m.fetchProgress.mockResolvedValue(progress({ stamps: 3, attended_workshops: 2 }));
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(2, 1, 'Galaxia'));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  const card = within(await screen.findByRole('region', { name: 'Sorteo' }));
  expect(card.getByText('Tu categoría del sorteo').nextElementSibling).toHaveTextContent('Galaxia');
  expect(card.getByText('Sellos académicos').nextElementSibling).toHaveTextContent('2');
  expect(card.getByText('Sellos de Vida Universitaria').nextElementSibling).toHaveTextContent('1');
  const tiers = within(card.getByRole('list', { name: 'Categorías del sorteo' })).getAllByRole('listitem');
  expect(tiers.slice(0, 3).map((li) => li.querySelector('strong')?.textContent)).toEqual(['Universo', 'Galaxia', 'Sistema Solar']);
  expect(tiers[0]).toHaveTextContent('3 académicos + 1 de Vida Universitaria, o 2 académicos + 2 de Vida Universitaria');
  expect(tiers[1]).toHaveTextContent('2 académicos + 1 de Vida Universitaria, o 4 sellos en total');
  expect(tiers[1]).toHaveTextContent('(tu categoría)');
  expect(tiers[0]).not.toHaveTextContent('(tu categoría)');
  expect(tiers[2]).toHaveTextContent('1 académico + 1 de Vida Universitaria');
  expect(card.getByText('Una misión de 60 minutos otorga 2 sellos; las demás, 1.')).toBeInTheDocument();
});

test('at the highest category there is nothing left to ask for', async () => {
  m.fetchProgress.mockResolvedValue(progress({ stamps: 4, attended_workshops: 2 }));
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(2, 2, 'Universo'));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  const card = within(await screen.findByRole('region', { name: 'Sorteo' }));
  expect(card.getByText('Estás en la categoría más alta.')).toBeInTheDocument();
  expect(card.queryByText(/Te falta/)).not.toBeInTheDocument();
});

test('a winner sees the prize notice instead of a category', async () => {
  m.fetchProgress.mockResolvedValue(progress({ stamps: 4, attended_workshops: 2 }));
  m.fetchMyRaffleStatus.mockResolvedValue(raffle(2, 2, null, { has_won: true }));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  const card = within(await screen.findByRole('region', { name: 'Sorteo' }));
  expect(card.getByText('¡Ganaste un premio!')).toBeInTheDocument();
  expect(card.queryByText('Tu categoría del sorteo')).not.toBeInTheDocument();
});

test('E: a change announced by another tab re-queries the Passport and updates it without a skeleton', async () => {
  m.fetchProgress.mockResolvedValueOnce(progress({ stamps: 7 }));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  expect(await screen.findByText(/^7 sellos ·/)).toBeInTheDocument();
  expect(m.fetchProgress).toHaveBeenCalledTimes(1);
  expect(m.listeners).toHaveLength(1);

  m.fetchProgress.mockResolvedValueOnce(progress({ stamps: 6, attended_workshops: 1 }));
  vi.useFakeTimers();
  act(() => m.listeners[0]('attendance'));
  // existing data stays on screen while the quiet refresh runs
  expect(screen.queryByRole('status', { name: 'Cargando' })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  vi.useRealTimers();
  await waitFor(() => expect(m.fetchProgress).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText(/^6 sellos ·/)).toBeInTheDocument());
  expect(screen.queryByText(/^7 sellos ·/)).not.toBeInTheDocument();
  // reloading never announces (no loop)
  expect(m.announce).not.toHaveBeenCalled();
});

test('la Bitácora abierta antes de las 12:30 descubre los intereses al llegar la hora', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T17:29:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
  m.edition = { interests_prompt_at: '2026-10-15T12:30:00-05:00' };
  m.fetchProgress
    .mockResolvedValueOnce(progress({ attended_workshops: 0 }))
    .mockResolvedValue(progress({
      attended_workshops: 0,
      post_event_interests_prompt: true,
      post_event_interests_open: true,
    }));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('link', { name: 'Elegir carreras' })).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await act(async () => { await Promise.resolve(); });
  expect(m.fetchProgress).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: 'Elegir carreras' })).toHaveAttribute('href', '/destinos');
  vi.useRealTimers();
});

test('a failed quiet refresh keeps the data already on screen', async () => {
  m.fetchProgress.mockResolvedValueOnce(progress({ stamps: 4 }));
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  await screen.findByText(/^4 sellos ·/);
  m.fetchProgress.mockRejectedValueOnce(new Error('offline'));
  vi.useFakeTimers();
  act(() => m.listeners[0]('reservation'));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  vi.useRealTimers();
  await waitFor(() => expect(m.fetchProgress).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/^4 sellos ·/)).toBeInTheDocument();
});

// ----------------------------------------------------------- el sorteo se entera de que la persona ya participa

async function scanWithRaffleProvider(res: CheckInResult | Error) {
  if (res instanceof Error) m.checkIn.mockRejectedValue(res);
  else m.checkIn.mockResolvedValue(res);
  render(<MemoryRouter><RafflePrizeProvider><Scanner /></RafflePrizeProvider></MemoryRouter>);
  await waitFor(() => expect(m.fetchPrizes).toHaveBeenCalledTimes(1)); // lectura al abrir
  fireEvent.change(screen.getByPlaceholderText('ABCDEF'), { target: { value: 'ABCDEF' } });
  fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
}

test('de cero asistencias a una: el primer check-in vuelve a consultar el sorteo de inmediato, sin esperar el latido', async () => {
  await scanWithRaffleProvider(result());
  await screen.findByRole('heading', { name: 'Misión completada' });
  await waitFor(() => expect(m.fetchPrizes).toHaveBeenCalledTimes(2));
});

test('un check-in repetido o fallido no vuelve a consultar el sorteo', async () => {
  await scanWithRaffleProvider(result({ already_registered: true }));
  await screen.findByRole('heading', { name: /./ });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(m.fetchPrizes).toHaveBeenCalledTimes(1);
});
