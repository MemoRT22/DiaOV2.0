import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { AMAZON, OFFICIAL } from './raffleFixtures';
import { defaultPrizes, drawn, fireEvent, openConsole, readyToDraw, screen, setReducedMotion, stage, view, waitFor, within } from './raffleRunHarness';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), pending: vi.fn(), invalidate: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, confirmWinner: m.confirm,
  markNoShow: m.noShow, fetchPendingSelection: m.pending, invalidateWinner: m.invalidate,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: ['coordinacion'] } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

let restoreMotion: () => void;
let prizes = defaultPrizes();
const winnerPending = (name = 'María Torres', id = 'w9') => ({ winner_id: id, display_name: name, prize_name: AMAZON, category_name: 'Sistema Solar', status: 'seleccionado' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  restoreMotion = setReducedMotion();
  prizes = defaultPrizes();
  m.view.mockImplementation(async () => view());
  m.prizes.mockImplementation(async (id: string) => (prizes as Record<string, unknown[]>)[id] ?? []);
  m.winners.mockResolvedValue([]);
  m.pending.mockResolvedValue({ winner_id: null });
  m.draw.mockResolvedValue(drawn());
  m.confirm.mockResolvedValue({ winner_id: 'w1', status: 'confirmado' });
  m.noShow.mockResolvedValue({ winner_id: 'w1', status: 'no_presentado' });
});
afterEach(() => { restoreMotion(); FakeBroadcastChannel.reset(); vi.unstubAllGlobals(); });

// ------------------------------------------------------------------ 1 · never read «could not ask» as «nobody is waiting»

test('the server confirming that nobody is waiting lets the round start', async () => {
  openConsole();
  await readyToDraw();
  expect(screen.queryByText(/No se pudo comprobar/)).not.toBeInTheDocument();
  expect(m.pending).toHaveBeenCalledWith('amazon');
});

test('a waiting winner is shown and the prize is not drawn again', async () => {
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? winnerPending() : { winner_id: null }));
  openConsole();
  expect(await within(await screen.findByLabelText('Escenario del sorteo')).findByText('María Torres')).toBeInTheDocument();
  expect(stage().queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
  expect(stage().queryByText(/Elegido entre/)).not.toBeInTheDocument();
});

test.each([
  ['a network error', new TypeError('Failed to fetch')],
  ['a temporary server error', Object.assign(new Error('upstream connect error or disconnect/reset before headers'), { status: 503 })],
])('%s while looking for a waiting winner blocks that prize, explains it and offers to retry', async (_label, failure) => {
  m.pending.mockImplementation(async (id: string) => { if (id === 'amazon') throw failure; return { winner_id: null }; });
  openConsole();
  expect(await screen.findByText(new RegExp(`No se pudo comprobar si «${AMAZON.replace('$', '\\$')}» tiene un ganador pendiente`))).toBeInTheDocument();
  expect(await stage().findByText(/No pudimos comprobar si este premio ya tiene un ganador pendiente/)).toBeInTheDocument();
  expect(stage().queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Reintentar comprobación' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: /Amazon/ })).toHaveAccessibleName(/Sin comprobar/);
  expect(m.draw).not.toHaveBeenCalled();
});

test('prizes that were checked stay available while another one is blocked', async () => {
  m.pending.mockImplementation(async (id: string) => { if (id === 'amazon') throw new Error('NETWORK'); return { winner_id: null }; });
  openConsole();
  await screen.findByText(/No se pudo comprobar/);
  fireEvent.click(screen.getByRole('radio', { name: /Apple Watch/ }));
  const button = await stage().findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText(/No se pudo comprobar/)).not.toBeInTheDocument();
  // coming back to the unchecked prize asks again: still unverified, still blocked
  fireEvent.click(screen.getByRole('radio', { name: /Amazon/ }));
  await waitFor(() => expect(screen.getByRole('radio', { name: /Amazon/ })).toHaveAccessibleName(/Sin comprobar/));
  expect(stage().queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
});

test('retrying the check clears the block when the server answers that nobody is waiting', async () => {
  let failing = true;
  m.pending.mockImplementation(async (id: string) => { if (id === 'amazon' && failing) throw new Error('NETWORK'); return { winner_id: null }; });
  openConsole();
  await screen.findByText(/No se pudo comprobar/);
  failing = false;
  fireEvent.click(stage().getByRole('button', { name: 'Reintentar comprobación' }));
  const button = await stage().findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText(/No se pudo comprobar/)).not.toBeInTheDocument();
});

test('retrying the check shows the winner that was waiting all along', async () => {
  let failing = true;
  m.pending.mockImplementation(async (id: string) => {
    if (id !== 'amazon') return { winner_id: null };
    if (failing) throw new Error('NETWORK');
    return winnerPending('Luis Pérez', 'w7');
  });
  openConsole();
  await screen.findByText(/No se pudo comprobar/);
  failing = false;
  fireEvent.click(stage().getByRole('button', { name: 'Reintentar comprobación' }));
  expect(await stage().findByText('Luis Pérez')).toBeInTheDocument();
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
});

test('a prize with zero units left because of a waiting winner is still recoverable', async () => {
  prizes.ss = [{ ...prizes.ss[0], quantity: 1, available: 0, delivered: 1 }];
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? winnerPending() : { winner_id: null }));
  openConsole();
  expect(await within(await screen.findByLabelText('Escenario del sorteo')).findByText('María Torres')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Amazon/ })).toHaveAccessibleName(/Ganador pendiente/);
});

test('a reload with a selection pending comes back ready to confirm', async () => {
  m.pending.mockImplementation(async (id: string) => (id === 'watch' ? winnerPending('Camila Ortega', 'w3') : { winner_id: null }));
  openConsole();
  expect(await within(await screen.findByLabelText('Escenario del sorteo')).findByText('Camila Ortega')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Apple Watch/ })).toBeChecked();
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: /Confirmar ganador/ }));
  await waitFor(() => expect(m.confirm).toHaveBeenCalledWith('w3'));
});

test('an unreadable answer is not «nobody is waiting» either', async () => {
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? null : { winner_id: null }));
  openConsole();
  expect(await screen.findByText(/No se pudo comprobar/)).toBeInTheDocument();
});

// ------------------------------------------------------------------ 2 · one logical draw, never a second one by accident

test('a double click makes a single request', async () => {
  const button = await (async () => { openConsole(); return readyToDraw(); })();
  act(() => { button.click(); button.click(); button.click(); });
  expect(await stage().findByText('Ana López')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(1);
});

test('a slow answer keeps the draw locked: nothing else can start until it resolves', async () => {
  let release!: (value: ReturnType<typeof drawn>) => void;
  m.draw.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  openConsole();
  fireEvent.click(await readyToDraw());
  await waitFor(() => expect(m.draw).toHaveBeenCalledTimes(1));
  expect(stage().getByRole('button', { name: /Sorteando/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Apple Watch/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Amazon/ })).toBeDisabled();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); }); // longer than the minimum spin in reduced motion
  expect(stage().queryByText('Ana López')).not.toBeInTheDocument();
  await act(async () => { release(drawn('Ana López')); });
  expect(await stage().findByText('Ana López')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(1);
});

test('a definitive refusal from the server is explained and not retried by itself', async () => {
  m.draw.mockRejectedValue(new Error('PRIZE_EXHAUSTED'));
  openConsole();
  fireEvent.click(await readyToDraw());
  expect(await screen.findByText('Este premio ya no tiene unidades disponibles.')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(1);
  expect(m.pending.mock.calls.filter(([id]) => id === 'amazon')).toHaveLength(1); // only the check at the start: nothing was uncertain
});

test('POOL_EMPTY while the aggregate still shows candidates explains the mismatch and does not trap the operator', async () => {
  m.draw.mockRejectedValue(new Error('POOL_EMPTY'));
  openConsole();
  fireEvent.click(await readyToDraw());
  expect(await stage().findByText(/El servidor no encontró participantes disponibles para esta ronda, aunque el conteo de la categoría todavía muestre candidatos/)).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled(); // the same request would fail again
  expect(stage().getByRole('button', { name: 'Actualizar datos' })).toBeEnabled();
  expect(m.draw).toHaveBeenCalledTimes(1);
  // another prize is not affected
  fireEvent.click(screen.getByRole('radio', { name: /Apple Watch/ }));
  const button = await stage().findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
});

test('a timeout with the draw possibly recorded recovers that very winner instead of drawing again', async () => {
  m.draw.mockRejectedValue(new TypeError('Failed to fetch'));
  openConsole();
  const button = await readyToDraw();
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? winnerPending('Valeria Gómez', 'w5') : { winner_id: null }));
  fireEvent.click(button);
  expect(await stage().findByText('Valeria Gómez')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(1);
  expect(stage().queryByRole('button', { name: /Sortear/ })).not.toBeInTheDocument();
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  expect(stage().queryByText(/Elegido entre/)).not.toBeInTheDocument(); // the pool of that draw is unknown, not 0
});

test('if nothing was recorded, retrying reuses the same operation key: it cannot duplicate', async () => {
  m.draw.mockRejectedValueOnce(new Error('upstream request timeout'));
  openConsole();
  fireEvent.click(await readyToDraw());
  expect(await stage().findByText(/no hay ningún ganador registrado para este premio/)).toBeInTheDocument();
  const retry = stage().getByRole('button', { name: 'Reintentar sorteo' });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  expect(await stage().findByText('Ana López')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(2);
  expect(m.draw.mock.calls[1][1]).toBe(m.draw.mock.calls[0][1]);
});

test('a replayed answer from the server resolves to the same winner', async () => {
  m.draw.mockRejectedValueOnce(new Error('NETWORK'));
  m.draw.mockResolvedValueOnce({ winner_id: 'w1', participant_id: 'p1', display_name: 'Ana López', prize_id: 'amazon', status: 'seleccionado', idempotent: true });
  openConsole();
  fireEvent.click(await readyToDraw());
  fireEvent.click(await stage().findByRole('button', { name: 'Reintentar sorteo' }));
  expect(await stage().findByText('Ana López')).toBeInTheDocument();
  expect(stage().getByText(AMAZON)).toBeInTheDocument();
  expect(stage().queryByText(/Elegido entre/)).not.toBeInTheDocument();
});

test('when the outcome cannot be verified the console stays locked and offers to check again', async () => {
  m.draw.mockRejectedValue(new TypeError('Failed to fetch'));
  openConsole();
  const button = await readyToDraw();
  m.pending.mockRejectedValue(new TypeError('Failed to fetch'));
  fireEvent.click(button);
  expect(await stage().findByText(/No pudimos confirmar si el servidor ya eligió un ganador/)).toBeInTheDocument();
  expect(stage().getByText('Resultado sin confirmar')).toBeInTheDocument();
  expect(stage().queryByRole('button', { name: /Sortear/ })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Apple Watch/ })).toBeDisabled();
  const again = stage().getByRole('button', { name: 'Comprobar de nuevo' });
  await waitFor(() => expect(again).toBeEnabled());
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? winnerPending('Diego Castillo', 'w8') : { winner_id: null }));
  fireEvent.click(again);
  expect(await stage().findByText('Diego Castillo')).toBeInTheDocument();
  expect(m.draw).toHaveBeenCalledTimes(1);
});

// ------------------------------------------------------------------ 3 · an unknown pool is not zero

test('a new draw reports the pool size the server gave', async () => {
  openConsole();
  fireEvent.click(await readyToDraw());
  expect(await stage().findByText('Elegido entre 12 participantes')).toBeInTheDocument();
});

test('a recovered selection never claims a pool size', async () => {
  m.pending.mockImplementation(async (id: string) => (id === 'amazon' ? winnerPending('María Torres') : { winner_id: null }));
  openConsole();
  expect(await within(await screen.findByLabelText('Escenario del sorteo')).findByText('María Torres')).toBeInTheDocument();
  expect(stage().getByText(AMAZON)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Elegido entre 0|Elegido entre/);
});

test('the category counter is not presented as the size of the draw', async () => {
  m.draw.mockResolvedValue(drawn('Ana López', { pool_size: undefined }));
  openConsole();
  fireEvent.click(await readyToDraw());
  await stage().findByText('Ana López');
  expect(stage().queryByText(/Elegido entre/)).not.toBeInTheDocument();
});

test('OFFICIAL fixtures keep their categories untouched', () => {
  expect(OFFICIAL.map((c) => c.name)).toEqual(['Universo', 'Galaxia', 'Sistema Solar']);
});
