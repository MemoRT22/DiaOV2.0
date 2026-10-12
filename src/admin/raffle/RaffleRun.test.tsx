import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import RaffleOperator from '../RaffleOperator';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { category, OFFICIAL, prize } from './raffleFixtures';

const m = vi.hoisted(() => ({
  view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), pending: vi.fn(), invalidate: vi.fn(),
  roles: { current: ['coordinacion'] as string[] },
}));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, confirmWinner: m.confirm,
  markNoShow: m.noShow, fetchPendingSelection: m.pending, invalidateWinner: m.invalidate,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: m.roles.current } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

// Reduced motion: the draw still waits for the server but skips the long spin and the letter-by-letter reveal.
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});
afterEach(() => { window.matchMedia = realMatchMedia; FakeBroadcastChannel.reset(); vi.unstubAllGlobals(); });

let prizes: Record<string, ReturnType<typeof prize>[]>;
const drawn = (name = 'Ana López', over = {}) => ({
  winner_id: 'w1', participant_id: 'p1', display_name: name, prize_id: 'tablet', prize_name: 'Tablet', category_id: 'un', category_name: 'Universo',
  status: 'seleccionado', pool_size: 4, idempotent: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.roles.current = ['coordinacion'];
  prizes = {
    un: [prize('tablet', 'un', 'Tablet', 3, 2), prize('audifonos', 'un', 'Audífonos', 1, 0)],
    ga: [prize('bocina', 'ga', 'Bocina', 5, 5)],
    ss: [],
  };
  m.view.mockImplementation(async () => structuredClone({ categories: OFFICIAL, unassigned_combinations: [] }));
  m.prizes.mockImplementation(async (id: string) => prizes[id] ?? []);
  m.winners.mockResolvedValue([]);
  m.pending.mockResolvedValue({ winner_id: null });
  m.draw.mockResolvedValue(drawn());
  m.confirm.mockResolvedValue({ winner_id: 'w1', status: 'confirmado' });
  m.noShow.mockResolvedValue({ winner_id: 'w1', status: 'no_presentado' });
});

const open = (Component: typeof RaffleAdmin = RaffleAdmin) => render(<MemoryRouter initialEntries={['/?seccion=ejecutar']}><Component /></MemoryRouter>);
const stage = () => within(screen.getByLabelText('Escenario del sorteo'));

test('starts on the first category that can be drawn, with its prize, pool and units on the stage', async () => {
  open();
  await waitFor(() => expect(screen.getByRole('radio', { name: /Universo/ })).toBeChecked());
  await waitFor(() => expect(screen.getByRole('radio', { name: /Tablet/ })).toBeChecked());
  await waitFor(() => expect(stage().getByText('4')).toBeInTheDocument());
  expect(stage().getByText('participantes compiten por')).toBeInTheDocument();
  expect(stage().getByRole('heading', { name: 'Tablet' })).toBeInTheDocument();
  expect(stage().getByText('2 de 3 unidades disponibles')).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeEnabled();
});

test('categories and prizes show what they have left and why some cannot be drawn', async () => {
  open();
  await screen.findByRole('radio', { name: /Audífonos/ });
  expect(screen.getByRole('radio', { name: /Universo/ })).toHaveAccessibleName(/4 elegibles · 2 premios por entregar/);
  expect(screen.getByRole('radio', { name: /Sistema Solar/ })).toHaveAccessibleName(/Sin premios/);
  expect(screen.getByRole('radio', { name: /Audífonos/ })).toHaveAccessibleName(/Agotado/);
});

test('a prize that ran out is selectable but blocks the draw and says so', async () => {
  open();
  fireEvent.click(await screen.findByRole('radio', { name: /Audífonos/ }));
  expect(await stage().findByText('Este premio está agotado: ya no quedan unidades.')).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled();
});

test('a category without prizes sends Coordinación to Preparación instead of offering a draw', async () => {
  open();
  fireEvent.click(await screen.findByRole('radio', { name: /Sistema Solar/ }));
  expect(await screen.findByText('Esta categoría no tiene premios.')).toBeInTheDocument();
  expect(stage().getByText('Esta categoría todavía no tiene premios.')).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ir a Preparación' }));
  expect(await screen.findByRole('tab', { name: 'Preparación', selected: true })).toBeInTheDocument();
});

test('a category without eligible participants cannot be drawn', async () => {
  m.view.mockResolvedValue({ categories: [category('un', 'Universo', 30, [{ total: 3 }], 0)], unassigned_combinations: [] });
  open();
  await screen.findByRole('radio', { name: /Universo/ });
  expect(await stage().findByText('No hay participantes elegibles en esta categoría.')).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled();
});

test('draws, reveals the winner and only then lets the operator decide', async () => {
  open();
  const button = await within(await screen.findByLabelText('Escenario del sorteo')).findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(stage().getByRole('button', { name: /Sorteando/ })).toBeDisabled();
  expect(m.draw).toHaveBeenCalledWith('tablet', expect.stringMatching(/^tablet-/));
  expect(await stage().findByText('Ana López')).toBeInTheDocument();
  expect(stage().getByText('Ganador')).toBeInTheDocument();
  expect(stage().getByText('Elegido entre 4 participantes')).toBeInTheDocument();
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  expect(stage().getByRole('button', { name: 'No se presentó' })).toBeEnabled();
});

async function drawOnce() {
  open();
  const button = await within(await screen.findByLabelText('Escenario del sorteo')).findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await stage().findByText('Ana López');
}

test('confirming marks the prize as delivered and moves on to the next round with the updated stock', async () => {
  await drawOnce();
  prizes.un = [prize('tablet', 'un', 'Tablet', 3, 1), prize('audifonos', 'un', 'Audífonos', 1, 0)];
  const confirm = stage().getByRole('button', { name: /Confirmar ganador/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(m.confirm).toHaveBeenCalledWith('w1'));
  expect(await stage().findByText('Entrega confirmada')).toBeInTheDocument();
  const next = stage().getByRole('button', { name: 'Siguiente ronda' });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  await waitFor(() => expect(stage().getByText('1 de 3 unidades disponibles')).toBeInTheDocument());
  expect(screen.getByRole('radio', { name: /Tablet/ })).toBeChecked();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeEnabled();
});

test('when the prize runs out the next round moves to the next prize that still has units', async () => {
  await drawOnce();
  prizes.un = [prize('tablet', 'un', 'Tablet', 3, 0), prize('audifonos', 'un', 'Audífonos', 1, 0)];
  prizes.ga = [prize('bocina', 'ga', 'Bocina', 5, 5)];
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: /Confirmar ganador/ }));
  const next = await stage().findByRole('button', { name: 'Siguiente ronda' });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  await waitFor(() => expect(screen.getByRole('radio', { name: /Galaxia/ })).toBeChecked());
  expect(screen.getByRole('radio', { name: /Bocina/ })).toBeChecked();
});

test('«No se presentó» asks first, frees the prize and offers to draw again', async () => {
  await drawOnce();
  await waitFor(() => expect(stage().getByRole('button', { name: 'No se presentó' })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: 'No se presentó' }));
  expect(m.noShow).not.toHaveBeenCalled();
  expect(stage().getByText(/¿Confirmas que no se presentó\?/)).toBeInTheDocument();
  fireEvent.click(stage().getByRole('button', { name: 'Cancelar' }));
  expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeInTheDocument();
  fireEvent.click(stage().getByRole('button', { name: 'No se presentó' }));
  fireEvent.click(stage().getByRole('button', { name: 'Sí, no se presentó' }));
  await waitFor(() => expect(m.noShow).toHaveBeenCalledWith('w1'));
  expect(await stage().findByText('Ana López no se presentó. El premio sigue disponible: puedes volver a sortear.')).toBeInTheDocument();
  m.draw.mockResolvedValue(drawn('Luis Pérez', { winner_id: 'w2' }));
  const again = stage().getByRole('button', { name: 'Sortear de nuevo' });
  await waitFor(() => expect(again).toBeEnabled());
  fireEvent.click(again);
  expect(await stage().findByText('Luis Pérez')).toBeInTheDocument();
});

test('a winner left pending (reload, second operator) comes back ready to confirm', async () => {
  m.pending.mockImplementation(async (id: string) => (id === 'tablet'
    ? { winner_id: 'w9', display_name: 'María Torres', prize_name: 'Tablet', category_name: 'Universo', status: 'seleccionado' }
    : { winner_id: null }));
  open();
  await screen.findByLabelText('Escenario del sorteo');
  expect(await stage().findByText('María Torres')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Tablet/ })).toHaveAccessibleName(/Ganador pendiente/);
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: /Confirmar ganador/ }));
  await waitFor(() => expect(m.confirm).toHaveBeenCalledWith('w9'));
});

test('a pending winner on a prize that shows no units left is still reachable', async () => {
  prizes.un = [prize('tablet', 'un', 'Tablet', 1, 0)];
  m.pending.mockImplementation(async (id: string) => (id === 'tablet' ? { winner_id: 'w9', display_name: 'María Torres' } : { winner_id: null }));
  open();
  await screen.findByLabelText('Escenario del sorteo');
  expect(await stage().findByText('María Torres')).toBeInTheDocument();
});

test('the demo environment is announced on the stage so nobody mistakes a rehearsal for the real draw', async () => {
  m.view.mockResolvedValue({ categories: [category('d', 'Universo', 10, [{ total: 3 }], 3, { is_demo: true })], unassigned_combinations: [] });
  prizes.d = [prize('dp', 'd', 'Premio de prueba', 1, 1, { category_id: 'd' })];
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Datos de prueba' }));
  expect(await stage().findByText('Ensayo · datos de prueba')).toBeInTheDocument();
});

test('with no categories there is nothing to draw and Coordinación is pointed to Preparación', async () => {
  m.view.mockResolvedValue({ categories: [], unassigned_combinations: [] });
  open();
  expect(await screen.findByText('Sin categorías reales.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ir a Preparación' })).toBeInTheDocument();
});

test('the raffle role operates the draw but cannot configure or invalidate', async () => {
  m.roles.current = ['sorteo'];
  open(RaffleOperator);
  await screen.findByRole('radio', { name: /Universo/ });
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Ejecutar sorteo', 'Historial']);
  expect(screen.queryByRole('button', { name: 'Datos de prueba' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Sistema Solar/ }));
  expect(await screen.findByText('Pide a Coordinación que los configure.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ir a Preparación' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Universo/ }));
  const button = await stage().findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await stage().findByText('Ana López');
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: /Confirmar ganador/ }));
  await stage().findByText('Entrega confirmada');
  expect(stage().queryByRole('button', { name: /Invalidar/ })).not.toBeInTheDocument();
});

test('Coordinación can invalidate a prize it just confirmed and draw again', async () => {
  await drawOnce();
  await waitFor(() => expect(stage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: /Confirmar ganador/ }));
  fireEvent.click(await stage().findByRole('button', { name: 'Invalidar y volver a sortear' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Invalidar ganador' }));
  m.invalidate.mockResolvedValue({ winner_id: 'w1', status: 'invalidado' });
  fireEvent.change(dialog.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Se fue antes' } });
  await act(async () => { fireEvent.click(dialog.getByRole('button', { name: 'Invalidar' })); });
  await waitFor(() => expect(m.invalidate).toHaveBeenCalledWith('w1', 'Se fue antes'));
  expect(await screen.findByText(/Ganador invalidado\. El premio volvió al inventario/)).toBeInTheDocument();
});
