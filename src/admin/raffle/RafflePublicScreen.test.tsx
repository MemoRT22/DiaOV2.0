import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PUBLIC_PATH, parsePublicMessage, toPublicState } from '../../lib/rafflePublic';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { AMAZON, demoCategories, demoPrizes } from './raffleFixtures';
import RaffleProjection from './RaffleProjection';
import { chooseRehearsalSet, consoleStage, defaultPrizes, drawn, fireEvent, openConsole, readyToDraw, screen, setReducedMotion, view, waitFor, within } from './raffleRunHarness';

const m = vi.hoisted(() => ({ mode: { current: 'operacion_real' }, view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), pending: vi.fn(), invalidate: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, confirmWinner: m.confirm,
  markNoShow: m.noShow, fetchPendingSelection: m.pending, invalidateWinner: m.invalidate,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: m.mode.current } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: ['coordinacion'] } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

let restoreMotion: () => void;
let prizes = defaultPrizes();

beforeEach(() => {
  vi.clearAllMocks();
  m.mode.current = 'operacion_real';
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

/** The projector window next to the console, in the same document: queries are scoped to each one. */
const openPublic = () => {
  const { container, unmount } = render(<RaffleProjection />);
  const stage = () => within(container.querySelector('.rf-public') as HTMLElement);
  return { container, unmount, stage };
};
const noControls = (container: HTMLElement) => {
  expect(container.querySelectorAll('button, a, input, select, textarea, [role="button"]')).toHaveLength(0);
  expect(container.textContent).not.toMatch(/Confirmar|No se presentó|Invalidar|Sortear de nuevo|Reintentar|Comprobar|Pantalla pública|No pudimos|Error|Algo salió mal/);
};

test('the public screen starts on its title, with no controls', async () => {
  const pub = openPublic();
  expect(pub.stage().getByRole('heading', { name: 'Sorteo final' })).toBeInTheDocument();
  noControls(pub.container);
});

test('before the draw it shows category, prize and pool; the console keeps every control', async () => {
  const pub = openPublic();
  openConsole();
  await readyToDraw();
  expect(await pub.stage().findByRole('heading', { name: AMAZON })).toBeInTheDocument();
  expect(pub.stage().getByText('participantes compiten por')).toBeInTheDocument();
  expect(pub.stage().getByText('Sistema Solar')).toBeInTheDocument();
  noControls(pub.container);
  expect(consoleStage().getByRole('button', { name: 'Sortear' })).toBeInTheDocument();
});

test('it follows the whole round — drawing, winner, confirmation, next round — decided from the console', async () => {
  const pub = openPublic();
  openConsole();
  fireEvent.click(await readyToDraw());
  expect(await pub.stage().findByText(/Sorteando entre/)).toBeInTheDocument();
  noControls(pub.container);
  expect(await pub.stage().findByText('Ana López')).toBeInTheDocument();
  expect(pub.stage().getByText('Elegido entre 12 participantes')).toBeInTheDocument();
  noControls(pub.container);

  await waitFor(() => expect(consoleStage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  fireEvent.click(consoleStage().getByRole('button', { name: /Confirmar ganador/ }));
  expect(await pub.stage().findByText('Entrega confirmada')).toBeInTheDocument();
  noControls(pub.container);

  prizes.ss = [{ ...prizes.ss[0], available: 9, delivered: 1 }];
  const next = await consoleStage().findByRole('button', { name: 'Siguiente ronda' });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  expect(await pub.stage().findByText('participantes compiten por')).toBeInTheDocument();
  expect(pub.stage().queryByText('Ana López')).not.toBeInTheDocument();
});

test('an absence is handled on the console and the audience only sees the prize ready again', async () => {
  const pub = openPublic();
  openConsole();
  fireEvent.click(await readyToDraw());
  await pub.stage().findByText('Ana López');
  await waitFor(() => expect(consoleStage().getByRole('button', { name: 'No se presentó' })).toBeEnabled());
  fireEvent.click(consoleStage().getByRole('button', { name: 'No se presentó' }));
  fireEvent.click(consoleStage().getByRole('button', { name: 'Sí, no se presentó' }));
  expect(await pub.stage().findByText('participantes compiten por')).toBeInTheDocument();
  expect(pub.container.textContent).not.toMatch(/Ana López|no se presentó/i);
  noControls(pub.container);
  expect(await consoleStage().findByText(/Ana López no se presentó/)).toBeInTheDocument();
});

test('problems stay on the console: the audience never sees an error, a block or an uncertain state', async () => {
  const pub = openPublic();
  openConsole();
  const button = await readyToDraw();
  m.draw.mockRejectedValue(new TypeError('Failed to fetch'));
  m.pending.mockRejectedValue(new TypeError('Failed to fetch'));
  fireEvent.click(button);
  await consoleStage().findByText(/No pudimos confirmar si el servidor ya eligió/);
  expect(pub.stage().getByText(/Sorteando entre/)).toBeInTheDocument(); // it simply keeps drawing
  noControls(pub.container);
  expect(pub.container.textContent).not.toMatch(/sin confirmar|conexión|servidor/i);
});

test('a prize that cannot be drawn shows the title on the public screen, not the reason', async () => {
  m.pending.mockRejectedValue(new Error('NETWORK'));
  const pub = openPublic();
  openConsole();
  await screen.findByText(/No se pudo comprobar/);
  await waitFor(() => expect(pub.stage().getByRole('heading', { name: 'Sorteo final' })).toBeInTheDocument());
  noControls(pub.container);
});

test('closing and reopening the public window brings back the round as it is', async () => {
  const first = openPublic();
  openConsole();
  fireEvent.click(await readyToDraw());
  await first.stage().findByText('Ana López');
  await waitFor(() => expect(consoleStage().getByRole('button', { name: /Confirmar ganador/ })).toBeEnabled());
  first.unmount();
  const second = openPublic();
  expect(await second.stage().findByText('Ana López')).toBeInTheDocument();
  expect(second.stage().getByText(AMAZON)).toBeInTheDocument();
  noControls(second.container);
});

test('the console notices when the public window is open and when it goes away', async () => {
  openConsole();
  await readyToDraw();
  expect(screen.getByText(/Pantalla pública · no abierta/)).toBeInTheDocument();
  const pub = openPublic();
  expect(await screen.findByText(/Pantalla pública · conectada/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Traer al frente' })).toBeInTheDocument();
  act(() => pub.unmount());
  await waitFor(() => expect(screen.getByText(/Pantalla pública · no abierta/)).toBeInTheDocument());
});

test('the console opens the public window by name, and says so when the browser blocks it', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  openConsole();
  await readyToDraw();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir pantalla pública' }));
  expect(open).toHaveBeenCalledWith(PUBLIC_PATH, 'dia-ov-sorteo-publico', expect.stringContaining('popup'));
  expect(await screen.findByText(/El navegador bloqueó la ventana/)).toBeInTheDocument();
  open.mockRestore();
});

test('in rehearsal mode the public screen carries the «Ensayo» mark; in official operation it does not', async () => {
  const official = openPublic();
  openConsole();
  await readyToDraw();
  expect(await official.stage().findByRole('heading', { name: AMAZON })).toBeInTheDocument();
  expect(official.stage().queryByText('Ensayo del evento')).not.toBeInTheDocument();
  official.unmount();
  FakeBroadcastChannel.reset();
  document.body.innerHTML = '';

  m.mode.current = 'preparacion';
  chooseRehearsalSet('demo');
  m.view.mockImplementation(async () => view(demoCategories()));
  m.prizes.mockImplementation(async (id: string) => (demoPrizes() as Record<string, unknown[]>)[id] ?? []);
  const rehearsal = openPublic();
  openConsole();
  await readyToDraw();
  expect(await rehearsal.stage().findByText('Ensayo del evento')).toBeInTheDocument();
  expect(await rehearsal.stage().findByRole('heading', { name: AMAZON })).toBeInTheDocument();
});

test('leaving the console leaves the title on the projector and keeps the rehearsal mark', async () => {
  m.mode.current = 'preparacion';
  chooseRehearsalSet('demo');
  m.view.mockImplementation(async () => view(demoCategories()));
  m.prizes.mockImplementation(async (id: string) => (demoPrizes() as Record<string, unknown[]>)[id] ?? []);
  const pub = openPublic();
  const consoleView = openConsole();
  await readyToDraw();
  await pub.stage().findByRole('heading', { name: AMAZON });
  consoleView.unmount();
  expect(await pub.stage().findByRole('heading', { name: 'Sorteo final' })).toBeInTheDocument();
  expect(pub.stage().getByText('Ensayo del evento')).toBeInTheDocument();
});

// ------------------------------------------------------------------ rehearsal on a single screen

test('the on-screen rehearsal has nothing to click, is driven from the keyboard and Esc leaves it', async () => {
  openConsole();
  await readyToDraw();
  fireEvent.click(screen.getByRole('button', { name: /Ensayar en esta pantalla/ }));
  const layer = screen.getByRole('dialog', { name: 'Ensayo en pantalla completa' });
  noControls(layer);
  expect(within(layer).getByRole('heading', { name: AMAZON })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: ' ' });
  expect(await within(layer).findByText('Ana López')).toBeInTheDocument();
  noControls(layer);
  await waitFor(() => expect(consoleStage().queryByRole('button', { name: 'Confirmar ganador' })).toBeEnabled());
  fireEvent.keyDown(window, { key: 'Enter' });
  await waitFor(() => expect(m.confirm).toHaveBeenCalledWith('w1'));
  expect(await within(layer).findByText('Entrega confirmada')).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Ensayo en pantalla completa' })).not.toBeInTheDocument();
  expect(consoleStage().getByText('Entrega confirmada')).toBeInTheDocument();
});

test('a problem closes the rehearsal so the operator sees it', async () => {
  openConsole();
  const button = await readyToDraw();
  fireEvent.click(screen.getByRole('button', { name: /Ensayar en esta pantalla/ }));
  m.draw.mockRejectedValue(new Error('PRIZE_EXHAUSTED'));
  expect(button).toBeInTheDocument();
  fireEvent.keyDown(window, { key: ' ' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ensayo en pantalla completa' })).not.toBeInTheDocument());
  expect(await screen.findByText('Este premio ya no tiene unidades disponibles.')).toBeInTheDocument();
});

test('the on-screen rehearsal of the event rehearsal is unmistakably marked', async () => {
  m.mode.current = 'preparacion';
  chooseRehearsalSet('demo');
  m.view.mockImplementation(async () => view(demoCategories()));
  m.prizes.mockImplementation(async (id: string) => (demoPrizes() as Record<string, unknown[]>)[id] ?? []);
  openConsole();
  await readyToDraw();
  fireEvent.click(screen.getByRole('button', { name: /Ensayar en esta pantalla/ }));
  expect(within(screen.getByRole('dialog', { name: 'Ensayo en pantalla completa' })).getByText('Ensayo del evento')).toBeInTheDocument();
});

// ------------------------------------------------------------------ what may cross to the audience

test('the public state has no field for errors, notices or controls', () => {
  const state = toPublicState({ rehearsal: false, phase: 'uncertain', ready: false, poolCount: 3, prize: { name: AMAZON, available: 1, quantity: 2 }, result: null });
  expect(Object.keys(state).sort()).toEqual(['categoryName', 'phase', 'poolCount', 'prize', 'registeredCount', 'rehearsal', 'result']);
  expect(state.phase).toBe('drawing');
  expect(toPublicState({ rehearsal: false, phase: 'idle', ready: false, poolCount: 3, result: null }).phase).toBe('standby');
});

test('a message that is not exactly a public state is ignored', () => {
  expect(parsePublicMessage({ type: 'state', state: { rehearsal: false, phase: 'ready', poolCount: 'x', prize: null, result: null, categoryName: null } })).toBeNull();
  expect(parsePublicMessage({ type: 'state', state: { rehearsal: 'maybe', phase: 'ready', poolCount: 1, prize: null, result: null, categoryName: null } })).toBeNull();
  expect(parsePublicMessage({ type: 'launch' })).toBeNull();
  expect(parsePublicMessage('x')).toBeNull();
  expect(parsePublicMessage({ type: 'state', state: null })).toEqual({ type: 'state', state: null });
});

test('the public screen shows the REAL number of registered students with a truthful caption; the operator console keeps the real pool', async () => {
  m.view.mockImplementation(async () => ({ ...view(), registered_total: 1850 }));
  const pub = openPublic();
  openConsole();
  await readyToDraw();
  expect(await pub.stage().findByText('1,850')).toBeInTheDocument();
  expect(pub.stage().getByText('alumnos inscritos en el Día OV')).toBeInTheDocument();
  expect(pub.stage().queryByText(/compiten por/)).toBeNull(); // nothing claims that all of them compete
  // the console (operator) still shows who really takes part
  expect(consoleStage().getByText('participantes compiten por')).toBeInTheDocument();
  noControls(pub.container);
});

test('without the registered total (older server) the public screen keeps its usual pool figure', async () => {
  const pub = openPublic();
  openConsole();
  await readyToDraw();
  expect(await pub.stage().findByText('participantes compiten por')).toBeInTheDocument();
});

test('the registered total travels through the public message and is validated', () => {
  const base = { rehearsal: false, phase: 'ready', poolCount: 3, prize: null, result: null, categoryName: null };
  expect(parsePublicMessage({ type: 'state', state: { ...base, registeredCount: 1850 } })).toMatchObject({ state: { registeredCount: 1850 } });
  expect(parsePublicMessage({ type: 'state', state: base })).toMatchObject({ state: { registeredCount: null } });
  expect(parsePublicMessage({ type: 'state', state: { ...base, registeredCount: 'x' } })).toBeNull();
});
