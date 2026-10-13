import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RaffleOperator from '../RaffleOperator';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { AMAZON, category, demoCategories, demoPrizes, IPAD, MACBOOK, OFFICIAL, officialPrizes, SWITCH, WATCH } from './raffleFixtures';
import { chooseRehearsalSet, fireEvent, openConsole, readyToDraw, screen, setReducedMotion, stage, view, waitFor, within } from './raffleRunHarness';

type Server = { prizes: ReturnType<typeof officialPrizes>; winners: { id: string; prize_id: string; status: string; name: string }[] };

const m = vi.hoisted(() => ({
  mode: { current: 'operacion_real' }, roles: { current: ['coordinacion'] as string[] },
  view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), pending: vi.fn(), invalidate: vi.fn(),
}));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, confirmWinner: m.confirm,
  markNoShow: m.noShow, fetchPendingSelection: m.pending, invalidateWinner: m.invalidate,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: m.mode.current } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: m.roles.current } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

const ALL = [...OFFICIAL, ...demoCategories()];
let restoreMotion: () => void;
let server: Server;
const taken = (prizeId: string) => server.winners.filter((w) => w.prize_id === prizeId && ['seleccionado', 'confirmado'].includes(w.status)).length;

/** A small stateful server: stock follows the winners, exactly like `raffle_prizes_read` does. */
function wire(prizes = officialPrizes()) {
  server = { prizes, winners: [] };
  const withStock = (list: ReturnType<typeof officialPrizes>[string]) => list.map((p) => ({ ...p, delivered: taken(p.id), available: p.quantity - taken(p.id) }));
  m.prizes.mockImplementation(async (id: string) => withStock(server.prizes[id] ?? []));
  m.winners.mockImplementation(async () => server.winners.map((w) => {
    const prize = Object.values(server.prizes).flat().find((p) => p.id === w.prize_id)!;
    const cat = ALL.find((c) => c.id === prize.category_id)!;
    return { id: w.id, prize_id: prize.id, prize_name: prize.name, category_id: cat.id, category_name: cat.name, display_name: w.name, status: w.status, drawn_at: '2026-10-22T16:00:00Z', confirmed_at: null, invalidation_reason: null, origin: 'online' };
  }));
  m.draw.mockImplementation(async (prizeId: string) => {
    const prize = Object.values(server.prizes).flat().find((p) => p.id === prizeId)!;
    if (server.winners.some((w) => w.prize_id === prizeId && w.status === 'seleccionado')) throw new Error('PENDING_SELECTION');
    if (taken(prizeId) >= prize.quantity) throw new Error('PRIZE_EXHAUSTED');
    const winner = { id: `w${server.winners.length + 1}`, prize_id: prizeId, status: 'seleccionado', name: `Alumno ${server.winners.length + 1}` };
    server.winners.push(winner);
    const cat = ALL.find((c) => c.id === prize.category_id)!;
    return { winner_id: winner.id, participant_id: `p${winner.id}`, display_name: winner.name, prize_id: prizeId, prize_name: prize.name, category_id: cat.id, category_name: cat.name, status: 'seleccionado', pool_size: 12, idempotent: false };
  });
  m.confirm.mockImplementation(async (id: string) => { server.winners.find((w) => w.id === id)!.status = 'confirmado'; return { winner_id: id, status: 'confirmado' }; });
  m.noShow.mockImplementation(async (id: string) => { server.winners.find((w) => w.id === id)!.status = 'no_presentado'; return { winner_id: id, status: 'no_presentado' }; });
  m.pending.mockImplementation(async (prizeId: string) => {
    const w = server.winners.find((x) => x.prize_id === prizeId && x.status === 'seleccionado');
    return w ? { winner_id: w.id, display_name: w.name, prize_name: 'x', category_name: 'x' } : { winner_id: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  restoreMotion = setReducedMotion();
  m.mode.current = 'operacion_real';
  m.roles.current = ['coordinacion'];
  m.view.mockImplementation(async () => view());
  wire();
});
afterEach(() => { restoreMotion(); FakeBroadcastChannel.reset(); vi.unstubAllGlobals(); });

const card = (name: RegExp | string) => screen.getByRole('radio', { name });
const stats = () => within(screen.getByLabelText('Resumen del sorteo'));
const drawAndConfirm = async () => {
  fireEvent.click(await readyToDraw());
  const confirm = await stage().findByRole('button', { name: /Confirmar ganador/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await stage().findByText('Entrega confirmada');
};

// ------------------------------------------------------------------ first impression: what to do and with what

test('opens on the live draw, with three clear places and the prizes ready to draw', async () => {
  openConsole();
  await readyToDraw();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Sorteo en vivo', 'Premios', 'Ganadores']);
  expect(screen.getByRole('tab', { name: 'Sorteo en vivo' })).toHaveAttribute('aria-selected', 'true');
  expect(stats().getByText(/premios por sortear de 16/).previousElementSibling).toHaveTextContent('16');
  expect(stats().getByText('participantes elegibles').previousElementSibling).toHaveTextContent('22');
  expect(stats().getByText(/categorías con premios de 3/).previousElementSibling).toHaveTextContent('3');
  expect(screen.getByRole('button', { name: 'Abrir pantalla pública' })).toBeInTheDocument();
  // nothing technical in the first screen
  expect(document.body.textContent).not.toMatch(/is_demo|REAL|DEMO|Datos reales|Datos de prueba|Nueva categoría|Nuevo premio|requisitos|sort_order/i);
});

test('the board shows the five official prizes, each in its own category, and they add up to 16', async () => {
  openConsole();
  await readyToDraw();
  const group = (name: string) => within(screen.getByRole('group', { name: `Premios de ${name}` }));
  expect(group('Universo').getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
    expect.stringContaining(MACBOOK), expect.stringContaining(IPAD),
  ]);
  expect(group('Galaxia').getAllByRole('radio')).toHaveLength(2);
  expect(group('Galaxia').getByText(new RegExp(WATCH))).toBeInTheDocument();
  expect(group('Galaxia').getByText(new RegExp(SWITCH))).toBeInTheDocument();
  expect(group('Sistema Solar').getAllByRole('radio')).toHaveLength(1);
  expect(group('Sistema Solar').getByText(/10 por sortear · 0 de 10 entregadas/)).toBeInTheDocument();
  expect(group('Universo').getByText(/2 por sortear · 0 de 2 entregadas/)).toBeInTheDocument();
});

test('the smaller prizes come first as a suggestion, and any prize can be picked', async () => {
  openConsole();
  await readyToDraw();
  expect(card(/Amazon/)).toBeChecked();
  expect(stage().getByRole('heading', { name: AMAZON })).toBeInTheDocument();
  expect(stage().getByText('participantes compiten por')).toBeInTheDocument();
  fireEvent.click(card(/iPad Air/));
  await waitFor(() => expect(stage().getByRole('heading', { name: IPAD })).toBeInTheDocument());
  expect(stage().getByText('2 de 2 unidades disponibles')).toBeInTheDocument();
  expect(stage().getByText('Universo')).toBeInTheDocument();
  fireEvent.click(card(/MacBook/));
  await waitFor(() => expect(stage().getByRole('heading', { name: MACBOOK })).toBeInTheDocument());
});

// ------------------------------------------------------------------ one round, and stock that follows the server

test('draw → winner → confirm: the stock comes back from the server', async () => {
  openConsole();
  await drawAndConfirm();
  await waitFor(() => expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent('9 por sortear · 1 de 10 entregadas'));
  expect(m.confirm).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(stats().getByText(/premios por sortear de 16/).previousElementSibling).toHaveTextContent('15'));
});

test('a drawn winner is a pending delivery, not yet an entregada, until it is confirmed', async () => {
  openConsole();
  fireEvent.click(await readyToDraw());
  await stage().findByText('Alumno 1');
  await waitFor(() => expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent('9 por sortear · 0 de 10 entregadas'));
});

test('the ten Amazon cards can be drawn ten times, one unit each, and then the prize is complete', async () => {
  openConsole();
  for (let round = 1; round <= 10; round += 1) {
    await drawAndConfirm();
    expect(m.draw).toHaveBeenCalledTimes(round);
    expect(m.draw.mock.calls[round - 1][0]).toBe('amazon');
    const next = stage().getByRole('button', { name: 'Siguiente ronda' });
    await waitFor(() => expect(next).toBeEnabled());
    if (round < 10) {
      fireEvent.click(next);
      await waitFor(() => expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent(`${10 - round} por sortear · ${round} de 10 entregadas`));
      expect(card(/Amazon/)).toBeChecked(); // same kind of prize, until it runs out
    }
  }
  expect(server.winners.filter((w) => w.status === 'confirmado')).toHaveLength(10);
  fireEvent.click(stage().getByRole('button', { name: 'Siguiente ronda' }));
  // the tenth was the last: the console moves on to the next category with something to draw
  await waitFor(() => expect(card(/Apple Watch/)).toBeChecked());
  expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent('Completo');
  expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent('10 de 10 entregadas');
}, 60_000);

test('a prize that is complete cannot be drawn again', async () => {
  wire({ ...officialPrizes(), ss: [{ ...officialPrizes().ss[0], quantity: 2 }] });
  server.winners.push({ id: 'a', prize_id: 'amazon', status: 'confirmado', name: 'A' }, { id: 'b', prize_id: 'amazon', status: 'confirmado', name: 'B' });
  openConsole();
  await screen.findByRole('group', { name: 'Premios de Sistema Solar' });
  fireEvent.click(card(/Amazon/));
  expect(await stage().findByText('Este premio está agotado: ya no quedan unidades.')).toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled();
  expect(m.draw).not.toHaveBeenCalled();
});

test('«No se presentó» frees the unit: the stock is not consumed', async () => {
  openConsole();
  fireEvent.click(await readyToDraw());
  await stage().findByText('Alumno 1');
  await waitFor(() => expect(stage().getByRole('button', { name: 'No se presentó' })).toBeEnabled());
  fireEvent.click(stage().getByRole('button', { name: 'No se presentó' }));
  fireEvent.click(stage().getByRole('button', { name: 'Sí, no se presentó' }));
  await waitFor(() => expect(m.noShow).toHaveBeenCalledWith('w1'));
  await waitFor(() => expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toHaveTextContent('10 por sortear · 0 de 10 entregadas'));
  expect(await stage().findByRole('button', { name: 'Sortear de nuevo' })).toBeInTheDocument();
});

// ------------------------------------------------------------------ event rehearsal vs official draw; sets of records

test('official operation says «Sorteo oficial» and has no switch between kinds of data', async () => {
  openConsole();
  await readyToDraw();
  expect(screen.getByText('Sorteo oficial')).toBeInTheDocument();
  expect(screen.queryByText('Ensayo del evento')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Datos (reales|de prueba)/ })).not.toBeInTheDocument();
});

test('the rehearsal mode says «Ensayo del evento», on the console and on the stage, and what the selections are', async () => {
  m.mode.current = 'preparacion';
  chooseRehearsalSet('demo');
  m.view.mockImplementation(async () => view(demoCategories()));
  m.prizes.mockImplementation(async (id: string) => (demoPrizes() as Record<string, unknown[]>)[id] ?? []);
  openConsole();
  await readyToDraw();
  expect(screen.getAllByText('Ensayo del evento').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Sorteo oficial')).not.toBeInTheDocument();
  expect(screen.getByText('Las selecciones se guardan como pruebas y deberán limpiarse antes del evento.')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/aún no cuenta como entrega/);
});

test('both sets of records answer together but only one is ever used: no duplicated categories, no mixed prizes', async () => {
  m.view.mockImplementation(async () => view([...OFFICIAL, ...demoCategories()]));
  m.prizes.mockImplementation(async (id: string) => ({ ...officialPrizes(), ...demoPrizes() } as Record<string, unknown[]>)[id] ?? []);
  openConsole();
  await readyToDraw();
  expect(screen.getAllByRole('group', { name: /^Premios de / })).toHaveLength(3);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  fireEvent.click(await readyToDraw());
  await stage().findByText('Alumno 1').catch(() => undefined);
  await waitFor(() => expect(m.draw).toHaveBeenCalled());
  expect(m.draw.mock.calls[0][0]).toBe('amazon'); // never the d-amazon of the other set
});

test('the raffle role stays on the set the server allows for the mode and cannot prepare or invalidate', async () => {
  m.roles.current = ['sorteo'];
  m.mode.current = 'preparacion';
  m.view.mockImplementation(async () => view([...OFFICIAL, ...demoCategories()])); // real records have the candidates, but the role may not touch them
  wire({ ...officialPrizes(), ...demoPrizes() });
  openConsole(RaffleOperator);
  await readyToDraw();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Sorteo en vivo', 'Ganadores']);
  expect(screen.getAllByText('Ensayo del evento').length).toBeGreaterThan(0);
  fireEvent.click(await readyToDraw());
  await waitFor(() => expect(m.draw).toHaveBeenCalled());
  expect(m.draw.mock.calls[0][0]).toBe('d-amazon');
  const confirm = await stage().findByRole('button', { name: /Confirmar ganador/ });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await stage().findByText('Entrega confirmada');
  expect(stage().queryByRole('button', { name: /Invalidar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Preparar|Ir a Premios/ })).not.toBeInTheDocument();
});

test('the raffle role cannot open the prizes place even by link', async () => {
  m.roles.current = ['sorteo'];
  openConsole(RaffleOperator, '/?seccion=premios');
  await readyToDraw();
  expect(screen.queryByRole('tab', { name: 'Premios' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sorteo en vivo', selected: true })).toBeInTheDocument();
});

test('links from before the simplification still land in the right place', async () => {
  const first = openConsole(undefined, '/?seccion=ejecutar');
  await readyToDraw();
  first.unmount();
  openConsole(undefined, '/?seccion=preparacion');
  expect(await screen.findByRole('tab', { name: 'Premios', selected: true })).toBeInTheDocument();
});

// ------------------------------------------------------------------ nothing registered yet

test('with no prizes registered Coordinación is pointed to the one step that fixes it', async () => {
  wire({ un: [], ga: [], ss: [] });
  openConsole();
  expect(await screen.findByText('Los premios todavía no están preparados.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ir a Premios' }));
  expect(await screen.findByRole('tab', { name: 'Premios', selected: true })).toBeInTheDocument();
});

test('the raffle role is told to ask Coordinación', async () => {
  m.roles.current = ['sorteo'];
  wire({ un: [], ga: [], ss: [] });
  openConsole(RaffleOperator);
  expect(await screen.findByText(/Avisa a Coordinación/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ir a Premios' })).not.toBeInTheDocument();
});

test('prizes that are not in the official catalog are never offered for the draw', async () => {
  const prizes = officialPrizes();
  prizes.ss.push({ ...prizes.ss[0], id: 'old', name: 'Premio de prueba anterior', quantity: 3, available: 3 });
  wire(prizes);
  openConsole();
  await readyToDraw();
  expect(screen.queryByText(/Premio de prueba anterior/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
});

test('a category outside the catalog is not offered either', async () => {
  m.view.mockImplementation(async () => view([...OFFICIAL, category('x', 'Baja', 5, [{ total: 1 }], 50)]));
  openConsole();
  await readyToDraw();
  expect(screen.queryByText('Baja')).not.toBeInTheDocument();
  expect(stats().getByText('participantes elegibles').previousElementSibling).toHaveTextContent('22');
});

test('Coordinación can invalidate a delivered prize it just confirmed and draw again', async () => {
  openConsole();
  await drawAndConfirm();
  fireEvent.click(await stage().findByRole('button', { name: 'Invalidar y volver a sortear' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Invalidar ganador' }));
  m.invalidate.mockResolvedValue({ winner_id: 'w1', status: 'invalidado' });
  fireEvent.change(dialog.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Se fue antes' } });
  await act(async () => { fireEvent.click(dialog.getByRole('button', { name: 'Invalidar' })); });
  await waitFor(() => expect(m.invalidate).toHaveBeenCalledWith('w1', 'Se fue antes'));
  expect(await screen.findByText(/Ganador invalidado\. El premio volvió al inventario/)).toBeInTheDocument();
});
