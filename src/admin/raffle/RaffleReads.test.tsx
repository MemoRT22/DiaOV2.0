import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { prizeTally, verified } from './PrizeParts';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { AMAZON, IPAD, MACBOOK, officialPrizes, prize, winner } from './raffleFixtures';
import { drawn, fireEvent, readyToDraw, screen, setReducedMotion, stage, view, waitFor, within } from './raffleRunHarness';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), confirm: vi.fn(), pending: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, confirmWinner: m.confirm, fetchPendingSelection: m.pending,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: ['coordinacion'] } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

let restoreMotion: () => void;
let prizes = officialPrizes();
let failing = new Set<string>();
let failView = false;
let failWinners = false;
let winners: ReturnType<typeof winner>[] = [];
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><RaffleAdmin /></MemoryRouter>);
const group = (name: string) => screen.getByRole('group', { name: `Premios de ${name}` });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  restoreMotion = setReducedMotion();
  prizes = officialPrizes(); failing = new Set(); failView = false; failWinners = false; winners = [];
  m.view.mockImplementation(async () => { if (failView) throw new TypeError('Failed to fetch'); return view(); });
  m.prizes.mockImplementation(async (id: string) => { if (failing.has(id)) throw new TypeError('Failed to fetch'); return structuredClone(prizes[id] ?? []); });
  m.winners.mockImplementation(async () => { if (failWinners) throw new TypeError('Failed to fetch'); return structuredClone(winners); });
  m.pending.mockResolvedValue({ winner_id: null });
  m.draw.mockResolvedValue(drawn());
  m.confirm.mockResolvedValue({ winner_id: 'w1', status: 'confirmado' });
});
afterEach(() => { restoreMotion(); FakeBroadcastChannel.reset(); vi.unstubAllGlobals(); });

// ------------------------------------------------------------------ the first read

test('a good first read shows the board with no warnings', async () => {
  open();
  await readyToDraw();
  expect(screen.queryByText(/No se pudo/)).not.toBeInTheDocument();
});

test.each([
  ['every category fails', ['un', 'ga', 'ss']],
  ['only one category fails', ['ga']],
])('a failed first read (%s) is not an empty catalog: nothing partial is published and it can be retried', async (_label, broken) => {
  failing = new Set(broken);
  open();
  expect(await screen.findByText(/No se pudieron consultar los premios\. No significa que no existan/)).toBeInTheDocument();
  expect(screen.queryByText('Los premios todavía no están preparados.')).not.toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument(); // not even the categories that did answer
  expect(screen.queryByLabelText('Resumen del sorteo')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Sortear/ })).not.toBeInTheDocument();
  failing = new Set();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await readyToDraw();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
});

test('the Premios view does not offer to «prepare» a catalog it could not read', async () => {
  failing = new Set(['un', 'ga', 'ss']);
  open('/?seccion=premios');
  await screen.findByText(/No se pudieron consultar los premios/);
  expect(screen.queryByRole('button', { name: /premios oficiales/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Los premios oficiales todavía no están registrados')).not.toBeInTheDocument();
});

// ------------------------------------------------------------------ a refresh that fails keeps the last complete read

async function drawFirst() {
  fireEvent.click(await readyToDraw());
  const confirm = await stage().findByRole('button', { name: /Confirmar ganador/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  return confirm;
}
/** After the draw the server would answer 9 left for the Amazon cards; the Galaxia read is the one that breaks. */
const afterDraw = () => { prizes.ss = [prize('amazon', 'ss', AMAZON, 10, 9, { sort_order: 1 })]; };

test('one category failing during a refresh keeps the previous inventory complete, says so, and holds back only NEW draws', async () => {
  open();
  const confirm = await drawFirst();
  afterDraw(); failing = new Set(['ga']);
  fireEvent.click(confirm);
  await stage().findByText('Entrega confirmada');
  expect(await screen.findByText(/No se pudo actualizar la información del servidor/)).toBeInTheDocument();
  // the Amazon cards read 9 on the server, but the new read was incomplete, so NOTHING of it is shown: no mix of old and new
  expect(group('Sistema Solar')).toHaveTextContent('10 por sortear');
  expect(group('Sistema Solar')).not.toHaveTextContent('9 por sortear');
  // the confirmed round is still there, and the next one cannot start on stale numbers
  expect(stage().getByText('Entrega confirmada')).toBeInTheDocument();
  fireEvent.click(stage().getByRole('button', { name: 'Siguiente ronda' }));
  expect(await stage().findByRole('button', { name: 'Reintentar actualización' })).toBeInTheDocument();
  expect(stage().queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
  expect(stage().getByText(/No se pudo actualizar el inventario/)).toBeInTheDocument();
});

test('retrying brings the whole fresh read at once and releases the draw', async () => {
  open();
  const confirm = await drawFirst();
  afterDraw(); failing = new Set(['un', 'ga', 'ss']);
  fireEvent.click(confirm);
  await stage().findByText('Entrega confirmada');
  await screen.findByText(/No se pudo actualizar la información del servidor/);
  failing = new Set();
  fireEvent.click(within(screen.getByText(/No se pudo actualizar la información/).closest('.alert, div')!.parentElement as HTMLElement).getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(screen.queryByText(/No se pudo actualizar la información del servidor/)).not.toBeInTheDocument());
  expect(group('Sistema Solar')).toHaveTextContent('9 por sortear');
  fireEvent.click(stage().getByRole('button', { name: 'Siguiente ronda' }));
  const again = await stage().findByRole('button', { name: 'Sortear' });
  await waitFor(() => expect(again).toBeEnabled());
});

test('a failed refresh right after confirming does not wipe the result or the screen', async () => {
  open();
  const confirm = await drawFirst();
  failView = true; // the next read of the pools fails as well
  fireEvent.click(confirm);
  await stage().findByText('Entrega confirmada');
  expect(await screen.findByText(/No se pudo actualizar la información del servidor/)).toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  expect(m.confirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/No se pudieron consultar los premios/)).not.toBeInTheDocument();
});

test('a winner pending when the connection drops can still be resolved safely', async () => {
  open();
  await readyToDraw();
  failing = new Set(['un', 'ga', 'ss']); failView = true; // the connection drops right as the draw is made
  fireEvent.click(await readyToDraw());
  const confirm = await stage().findByRole('button', { name: /Confirmar ganador/ });
  await screen.findByText(/No se pudo actualizar la información del servidor/);
  expect(await stage().findByText('Ana López')).toBeInTheDocument(); // the result stays on screen
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(m.confirm).toHaveBeenCalledWith('w1'));
  await stage().findByText('Entrega confirmada');
});

test('the numbers are never presented as current when they could not be verified: Premios warns too and cannot prepare', async () => {
  open('/?seccion=premios');
  await screen.findByText('Los premios oficiales están registrados.');
  failing = new Set(['ga']);
  fireEvent.click(screen.getByRole('tab', { name: 'Sorteo en vivo' }));
  await readyToDraw();
  // force a refresh through a step that needs one
  fireEvent.click(await readyToDraw());
  const confirm = await stage().findByRole('button', { name: /Confirmar ganador/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  await screen.findByText(/No se pudo actualizar la información del servidor/);
  fireEvent.click(screen.getByRole('tab', { name: 'Premios' }));
  expect(await screen.findByText(/No se pudo actualizar la información del servidor/)).toBeInTheDocument();
});

// ------------------------------------------------------------------ delivered vs waiting

test('prizeTally: confirmed are delivered, selected are waiting, the rest follows the server', () => {
  const amazon = prize('amazon', 'ss', AMAZON, 10, 5, { delivered: 5 });
  const rows = [
    winner('a', 'confirmado'), winner('b', 'confirmado'), winner('c', 'seleccionado'), winner('d', 'seleccionado'), winner('e', 'seleccionado'),
    winner('f', 'no_presentado'), winner('g', 'invalidado'), winner('h', 'confirmado', { prize_id: 'other' }),
  ];
  expect(prizeTally(amazon, rows)).toMatchObject({ confirmed: 2, waiting: 3, left: 5, committed: 5, quantity: 10 });
});

test('prizeTally without the results: deliveries are UNKNOWN (null), never zero and never the committed total', () => {
  const amazon = prize('amazon', 'ss', AMAZON, 10, 5, { delivered: 5 });
  const tally = prizeTally(amazon, null);
  expect(tally).toMatchObject({ confirmed: null, waiting: null, committed: 5, left: 5 });
  expect(verified(tally)).toBe(false);
  expect(verified(prizeTally(amazon, []))).toBe(true);
  expect(prizeTally(amazon, [])).toMatchObject({ confirmed: 0, waiting: 0 }); // zero is a known answer
});

const premios = async () => { open('/?seccion=premios'); await screen.findByRole('article', { name: 'Categoría Sistema Solar' }); };
const card = (name: string) => within(screen.getByRole('article', { name: `Categoría ${name}` }));

test('every winner confirmed: all delivered, none pending', async () => {
  prizes.un = [prize('macbook', 'un', MACBOOK, 1, 0), prize('ipad', 'un', IPAD, 2, 2)];
  winners = [winner('w1', 'confirmado', { prize_id: 'macbook', prize_name: MACBOOK, category_id: 'un', category_name: 'Universo' })];
  await premios();
  expect(await screen.findByText('1 de 1 entregado')).toBeInTheDocument();
  expect(card('Universo').queryByText(/pendiente de confirmar/)).not.toBeInTheDocument();
});

test('a pending winner is shown as pending and is NOT counted as delivered', async () => {
  prizes.un = [prize('macbook', 'un', MACBOOK, 1, 0), prize('ipad', 'un', IPAD, 2, 2)];
  winners = [winner('w1', 'seleccionado', { prize_id: 'macbook', prize_name: MACBOOK, category_id: 'un', category_name: 'Universo' })];
  await premios();
  expect(await screen.findByText(/0 de 1 entregado · 1 pendiente de confirmar/)).toBeInTheDocument();
  const stats = within(screen.getByLabelText('Resumen de premios'));
  expect(stats.getByText('entregados').previousElementSibling).toHaveTextContent('0');
});

test('Amazon cards with 3 delivered, 2 waiting, one absent and one invalidated: 3 delivered, 2 pending, 5 left', async () => {
  prizes.ss = [prize('amazon', 'ss', AMAZON, 10, 5, { sort_order: 1 })];
  winners = [
    ...['a', 'b', 'c'].map((id) => winner(id, 'confirmado')), ...['d', 'e'].map((id) => winner(id, 'seleccionado')),
    winner('f', 'no_presentado'), winner('g', 'invalidado'),
  ];
  await premios();
  expect(await screen.findByText(/3 de 10 entregadas · 2 pendientes de confirmar/)).toBeInTheDocument();
  expect(card('Sistema Solar').getByLabelText('5 por sortear de 10')).toBeInTheDocument();
});

test('when the results cannot be read the inventory stays, deliveries are marked unverified and pending is never turned into delivered', async () => {
  failWinners = true;
  prizes.ss = [prize('amazon', 'ss', AMAZON, 10, 5, { sort_order: 1, delivered: 5 })];
  await premios();
  expect(await screen.findByText(/5 comprometidas · entregas sin verificar/)).toBeInTheDocument();
  expect(card('Sistema Solar').getByLabelText('5 por sortear de 10')).toBeInTheDocument(); // the stock the server did give
  expect(document.body.textContent).not.toMatch(/5 de 10 entregadas/);
  const stats = within(screen.getByLabelText('Resumen de premios'));
  expect(stats.getByText('entregados · sin verificar').previousElementSibling).toHaveTextContent('—');
});

test('the live board says the same: unverified deliveries, never a guessed number', async () => {
  failWinners = true;
  prizes.ss = [prize('amazon', 'ss', AMAZON, 10, 5, { sort_order: 1, delivered: 5 })];
  open();
  await readyToDraw();
  expect(group('Sistema Solar')).toHaveTextContent('5 por sortear · 5 comprometidas · entregas sin verificar');
  expect(group('Sistema Solar')).not.toHaveTextContent('entregadas');
});

test('ten Amazon cards partly delivered, from the server: 3 de 10 entregadas, 7 por sortear', async () => {
  prizes.ss = [prize('amazon', 'ss', AMAZON, 10, 7, { sort_order: 1 })];
  winners = ['a', 'b', 'c'].map((id) => winner(id, 'confirmado'));
  open();
  await readyToDraw();
  expect(group('Sistema Solar')).toHaveTextContent('7 por sortear · 3 de 10 entregadas');
});

test('the history is not shown as empty when the results could not be read', async () => {
  failWinners = true;
  open('/?seccion=ganadores');
  expect(await screen.findByText(/No se pudieron consultar los resultados/)).toBeInTheDocument();
  expect(screen.queryByText('Todavía no hay ganadores.')).not.toBeInTheDocument();
});
