import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CheckInResult } from '../lib/checkin';
import { neutralTheme } from '../theme/neutralTheme';
import PassportPage from './PassportPage';
import Scanner from './Scanner';

const m = vi.hoisted(() => ({
  checkIn: vi.fn(),
  announce: vi.fn(),
  fetchProgress: vi.fn(),
  fetchDivisions: vi.fn(),
  fetchMyRaffleStatus: vi.fn(),
  fetchBoard: vi.fn(),
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
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Alumno E2E' }, signOut: vi.fn() }) }));
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

beforeEach(() => {
  vi.clearAllMocks();
  m.listeners = [];
  m.fetchDivisions.mockResolvedValue([]);
  m.fetchBoard.mockResolvedValue(null);
  m.fetchMyRaffleStatus.mockResolvedValue({ has_won: false, raffle_category_name: null, academic_tickets: 1, leadership_tickets: 0 });
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

test('B: a repeated check-in is a successful, idempotent outcome that never shows +1', async () => {
  await scan(result({ already_registered: true }));
  expect(await screen.findByRole('heading', { name: 'Asistencia ya registrada' })).toBeInTheDocument();
  expect(screen.queryByText('+1')).not.toBeInTheDocument();
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

test('C: singular — “1 misión académica”', async () => {
  m.fetchProgress.mockResolvedValue(progress());
  m.fetchMyRaffleStatus.mockResolvedValue({ has_won: false, raffle_category_name: null, academic_tickets: 2, leadership_tickets: 0 });
  render(<MemoryRouter><PassportPage /></MemoryRouter>);
  expect(await screen.findByText('Te falta completar 1 misión académica.')).toBeInTheDocument();
});

test('D: plural — “2 misiones académicas”, never “misiónes”', async () => {
  m.fetchProgress.mockResolvedValue(progress());
  m.fetchMyRaffleStatus.mockResolvedValue({ has_won: false, raffle_category_name: null, academic_tickets: 1, leadership_tickets: 0 });
  const { container } = render(<MemoryRouter><PassportPage /></MemoryRouter>);
  expect(await screen.findByText('Te faltan completar 2 misiones académicas.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/misiónes/i);
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
