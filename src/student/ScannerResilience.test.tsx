import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AccessError } from '../lib/accessErrors';
import { neutralTheme } from '../theme/neutralTheme';
import Scanner from './Scanner';

const m = vi.hoisted(() => ({ check: vi.fn(), progress: vi.fn(), next: vi.fn(), raffle: vi.fn(), prizes: vi.fn(), survey: vi.fn(), announce: vi.fn(), decode: null as null | ((r: { data: string }) => void) }));
vi.mock('qr-scanner', () => ({ default: class {
  constructor(_video: unknown, decode: typeof m.decode) { m.decode = decode; }
  start = vi.fn(); stop = vi.fn(); destroy = vi.fn();
} }));
vi.mock('../lib/checkin', () => ({ checkIn: m.check }));
vi.mock('../lib/catalog', async (orig) => ({ ...await orig<typeof import('../lib/catalog')>(), fetchProgress: m.progress }));
vi.mock('../lib/reservations', () => ({ fetchBoard: m.next }));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.raffle }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: m.announce }));
vi.mock('./RafflePrizeProvider', () => ({ useRafflePrizes: () => ({ refresh: m.prizes }) }));
vi.mock('./ExitSurveyProvider', () => ({ useExitSurvey: () => ({ refresh: m.survey }) }));
vi.mock('../theme/PublicThemeProvider', () => ({ usePublicTheme: () => ({ theme: neutralTheme,
  term: (key: 'stamp' | 'rank', plural = false) => neutralTheme.vocabulary[key][plural ? 'many' : 'one'], rankName: () => 'Explorador' }) }));
const result = { already_registered: false, session_id: 's', activity_id: 'a', title: 'Misión prueba', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T16:00:00Z', credits_granted: 2, method: 'qr', stamps: 2, attended_workshops: 1, level: 1 };
const mount = () => render(<MemoryRouter><Scanner /></MemoryRouter>);
const flush = () => act(async () => { await Promise.resolve(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const manual = () => {
  fireEvent.change(screen.getByLabelText('Código de 6 letras'), { target: { value: 'ABCDEF' } });
  fireEvent.submit(screen.getByLabelText('Código de 6 letras').closest('form')!);
};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
  m.check.mockResolvedValue(result); m.progress.mockResolvedValue(null); m.next.mockResolvedValue(null); m.raffle.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test('lost answer preserves the QR in memory, honors Retry-After, and reconfirms manually without extra stamps', async () => {
  m.check.mockRejectedValueOnce(new AccessError('RATE_LIMITED', 17)).mockResolvedValueOnce({ ...result, already_registered: true });
  mount();
  act(() => m.decode!({ data: 'opaque-private-QR' }));
  await flush();
  expect(screen.getByText('No pudimos confirmar tu asistencia')).toBeInTheDocument();
  expect(screen.getByText(/podría haberse registrado/)).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('opaque-private-QR');
  expect(sessionStorage.length).toBe(0);
  expect(screen.getByRole('button', { name: 'Reintentar en 17 s' })).toBeDisabled();
  manual(); // even a programmatic form submit cannot bypass the cooldown
  await tick(16_999);
  expect(m.check).toHaveBeenCalledTimes(1);
  await tick(251);
  fireEvent.click(screen.getByRole('button', { name: 'Volver a confirmar' }));
  await flush();
  expect(m.check).toHaveBeenLastCalledWith('opaque-private-QR', expect.any(AbortSignal));
  expect(screen.getByRole('heading', { name: 'Asistencia ya registrada' })).toBeInTheDocument();
  expect(screen.queryByText('+2')).not.toBeInTheDocument();
  expect(m.announce).toHaveBeenCalledOnce(); // synchronize a first commit whose answer was lost
});

test('QR and simultaneous manual submits share one in-flight lock', async () => {
  let finish!: (value: typeof result) => void;
  m.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount();
  act(() => m.decode!({ data: 'opaque-private-QR' }));
  manual(); manual();
  expect(m.check).toHaveBeenCalledTimes(1);
  await act(async () => finish(result));
  expect(screen.getByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
});

test('success appears before all secondary reads; failures cannot replace the confirmed stamp', async () => {
  m.progress.mockRejectedValue(new Error('offline')); m.raffle.mockRejectedValue(new Error('offline')); m.next.mockRejectedValue(new Error('offline'));
  mount(); manual(); await flush();
  expect(screen.getByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
  expect(m.progress).not.toHaveBeenCalled(); expect(m.next).not.toHaveBeenCalled(); expect(m.raffle).not.toHaveBeenCalled();
  expect(m.prizes).toHaveBeenCalledTimes(1);
  expect(m.prizes).toHaveBeenCalledWith({ afterAttendance: true });
  expect(m.survey).toHaveBeenCalledTimes(1);
  expect(m.survey).toHaveBeenCalledWith({ afterAttendance: true });
  await tick(3000);
  expect(m.progress).toHaveBeenCalledOnce(); expect(m.next).toHaveBeenCalledOnce(); expect(m.raffle).toHaveBeenCalledOnce();
  await tick(60_000);
  expect(m.next).toHaveBeenCalledOnce(); // no new polling/retries
  expect(screen.getByText('+2')).toBeInTheDocument();
});

test('leaving during a check-in aborts it and discards a late success and all its secondary effects', async () => {
  let finish!: (value: typeof result) => void;
  m.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = mount(); manual();
  const signal = m.check.mock.calls[0][1] as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => finish(result)); await tick(4000);
  expect(m.progress).not.toHaveBeenCalled(); expect(m.announce).not.toHaveBeenCalled(); expect(m.prizes).not.toHaveBeenCalled();
});

test('leaving a success screen cancels deferred reads; obsolete data cannot enter a later scan', async () => {
  const view = mount(); manual(); await flush(); view.unmount(); await tick(4000);
  expect(m.progress).not.toHaveBeenCalled(); expect(m.next).not.toHaveBeenCalled();
});

test('a fresh server progress with no active reservations avoids the complete board altogether', async () => {
  m.progress.mockResolvedValue({ reserved_workshops: 0 });
  mount(); manual(); await flush(); await tick(3000);
  expect(m.progress).toHaveBeenCalledTimes(1);
  expect(m.next).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
});

test('when progress confirms an active route, exactly one deferred board read preserves the next-mission hint', async () => {
  m.progress.mockResolvedValue({ reserved_workshops: 1 });
  mount(); manual(); await flush();
  expect(m.next).not.toHaveBeenCalled();
  await tick(3000);
  expect(m.next).toHaveBeenCalledTimes(1);
});
