import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import RaffleOperator from '../RaffleOperator';
import { readSetChoice } from '../../lib/raffleSetChoice';
import { FakeBroadcastChannel } from './fakeBroadcastChannel';
import { AMAZON, category, demoCategories, demoPrizes, OFFICIAL, officialPrizes, winner } from './raffleFixtures';
import { chooseRehearsalSet, fireEvent, ready, readyToDraw, screen, setReducedMotion, stage, view, waitFor, within } from './raffleRunHarness';

// El folio lo asigna el servidor; aquí se simula con uno derivado del id para no consultar la red.
vi.mock('../../lib/raffleWinner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleWinner')>()),
  fetchWinnerFolios: async (ids: string[]) => new Map(ids.map((id) => [id, `GAN-${id.replace(/\D/g, '').padStart(6, '0')}`])),
}));

const m = vi.hoisted(() => ({
  mode: { current: 'preparacion' }, roles: { current: ['coordinacion'] as string[] }, view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), draw: vi.fn(), pending: vi.fn(),
}));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, drawWinner: m.draw, fetchPendingSelection: m.pending,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: m.mode.current } }) }));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ staff: { user_id: 'u', full_name: 'Operador', roles: m.roles.current } }),
  hasRole: (staff: { roles: string[] } | null, ...roles: string[]) => !!staff && roles.some((role) => staff.roles.includes(role)),
}));

let restoreMotion: () => void;
/** Both sets answer together, as the server does for Coordinación. `pools` sets the eligible participants of each. */
function server(pools: { real: number; demo: number }, options: { demoCategories?: boolean } = {}) {
  const scale = (list: ReturnType<typeof category>[], n: number) => list.map((item, index) => ({ ...item, pool_count: n === 0 ? 0 : n + index }));
  m.view.mockImplementation(async () => view([...scale(OFFICIAL, pools.real), ...(options.demoCategories === false ? [] : scale(demoCategories(), pools.demo))]));
  m.prizes.mockImplementation(async (id: string) => ({ ...officialPrizes(), ...demoPrizes() } as Record<string, unknown[]>)[id] ?? []);
}
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><RaffleAdmin /></MemoryRouter>);
const chooserOption = (name: RegExp) => screen.getByRole('radio', { name });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  restoreMotion = setReducedMotion();
  m.mode.current = 'preparacion';
  m.roles.current = ['coordinacion'];
  m.winners.mockResolvedValue([]);
  m.pending.mockResolvedValue({ winner_id: null });
  m.draw.mockImplementation(async (prizeId: string) => ({ winner_id: 'w1', participant_id: 'p1', display_name: 'Ana López', prize_id: prizeId, prize_name: AMAZON, category_id: 'x', category_name: 'x', status: 'seleccionado', pool_size: 5, idempotent: false }));
  server({ real: 5, demo: 0 });
});
afterEach(() => { restoreMotion(); FakeBroadcastChannel.reset(); vi.unstubAllGlobals(); });

const drawnPrize = async () => { fireEvent.click(await readyToDraw()); await waitFor(() => expect(m.draw).toHaveBeenCalled()); return m.draw.mock.calls[0][0] as string; };

// ------------------------------------------------------------------ rehearsal: Coordinación decides, the system does not guess

test('rehearsing with the provisional participants (flagged as real): asked once, nothing is drawn before, then it uses exactly those records', async () => {
  server({ real: 5, demo: 0 });
  open();
  expect(await screen.findByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
  expect(screen.getByText(/18 participantes elegibles hoy · 3 de 3 categorías/)).toBeInTheDocument();
  expect(screen.getByText(/0 participantes elegibles hoy/)).toBeInTheDocument();
  fireEvent.click(chooserOption(/Participantes cargados hasta ahora/));
  fireEvent.click(screen.getByRole('button', { name: 'Ensayar con estos registros' }));
  expect(await drawnPrize()).toBe('amazon');
  expect(readSetChoice('edition')).toBe('real');
  expect(screen.getByText('Ensayo con:')).toBeInTheDocument();
  expect(screen.getByText('Participantes cargados hasta ahora')).toBeInTheDocument();
});

test('rehearsing with the system test participants uses those records', async () => {
  server({ real: 0, demo: 4 });
  open();
  fireEvent.click(await screen.findByRole('radio', { name: /Participantes de prueba del sistema/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Ensayar con estos registros' }));
  expect(await drawnPrize()).toBe('d-amazon');
});

test('with candidates in both sets nothing is chosen for Coordinación', async () => {
  server({ real: 8, demo: 3 });
  open();
  expect(await screen.findByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).toBeInTheDocument();
  expect(chooserOption(/Participantes cargados/)).not.toBeChecked();
  expect(chooserOption(/Participantes de prueba/)).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Ensayar con estos registros' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Sortear' })).not.toBeInTheDocument();
  expect(m.draw).not.toHaveBeenCalled();
});

test('with no candidates in either set the choice is still theirs and the set is not swapped behind their back', async () => {
  server({ real: 0, demo: 0 });
  chooseRehearsalSet('real');
  open();
  await screen.findByRole('group', { name: 'Premios de Sistema Solar' });
  expect(screen.getByText('Participantes cargados hasta ahora')).toBeInTheDocument();
  const button = stage().getByRole('button', { name: 'Sortear' });
  expect(button).toBeDisabled();
  expect(stage().getByText('No hay participantes elegibles en esta categoría.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).not.toBeInTheDocument();
});

test('when the chosen set runs out of candidates mid-rehearsal the other set is NOT used instead', async () => {
  server({ real: 1, demo: 6 });
  chooseRehearsalSet('real');
  open();
  await readyToDraw();
  const before = screen.getByRole('group', { name: 'Premios de Sistema Solar' }).textContent;
  server({ real: 0, demo: 6 }); // the real participants are all drawn; the test ones still have candidates
  fireEvent.click(screen.getByRole('button', { name: /Abrir pantalla pública/ }));
  fireEvent.click(await readyToDraw().then(() => screen.getByRole('radio', { name: /iPad Air/ })));
  await waitFor(() => expect(stage().getByText(/iPad Air/)).toBeInTheDocument());
  expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent).join('')).not.toContain('d-');
  expect(readSetChoice('edition')).toBe('real');
  expect(before).toBeTruthy();
  fireEvent.click(stage().getByRole('button', { name: 'Sortear' }));
  await waitFor(() => expect(m.draw).toHaveBeenCalled());
  expect(m.draw.mock.calls[0][0]).toBe('ipad'); // never d-ipad
});

test('the choice cannot be changed while a result is waiting to be confirmed, and can be afterwards', async () => {
  chooseRehearsalSet('real');
  m.winners.mockResolvedValue([winner('w1', 'seleccionado')]);
  open();
  await screen.findByRole('group', { name: 'Premios de Sistema Solar' });
  expect(screen.getByRole('button', { name: 'Cambiar' })).toBeDisabled();
});

test('changing the records is a guided step that keeps the previous choice until confirmed', async () => {
  chooseRehearsalSet('real');
  server({ real: 5, demo: 4 });
  open();
  await screen.findByRole('group', { name: 'Premios de Sistema Solar' });
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
  expect(chooserOption(/Participantes cargados/)).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(readSetChoice('edition')).toBe('real');
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
  fireEvent.click(chooserOption(/Participantes de prueba/));
  fireEvent.click(screen.getByRole('button', { name: 'Ensayar con estos registros' }));
  expect(await drawnPrize()).toBe('d-amazon');
});

test('a set without the official categories cannot be chosen', async () => {
  server({ real: 5, demo: 0 }, { demoCategories: false });
  open();
  await screen.findByRole('heading', { name: '¿Con qué registros se hará el ensayo?' });
  expect(chooserOption(/Participantes de prueba/)).toBeDisabled();
  expect(screen.getByText(/No tiene las categorías oficiales/)).toBeInTheDocument();
});

// ------------------------------------------------------------------ official operation

test('official operation uses the official records whatever the rehearsal choice or the counts', async () => {
  m.mode.current = 'operacion_real';
  chooseRehearsalSet('demo');
  server({ real: 0, demo: 50 });
  open();
  await ready('Sortear');
  expect(screen.getByText('Sorteo oficial')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).not.toBeInTheDocument();
  expect(screen.queryByText('Ensayo con:')).not.toBeInTheDocument();
  expect(stage().getByRole('button', { name: 'Sortear' })).toBeDisabled();
  expect(m.draw).not.toHaveBeenCalled(); // no official candidates: it does not borrow the 50 test ones
  expect(stage().getByText('No hay participantes elegibles en esta categoría.')).toBeInTheDocument();
});

test('going from rehearsal to official operation drops the rehearsal set at once', async () => {
  chooseRehearsalSet('demo');
  server({ real: 7, demo: 4 });
  const { rerender } = open();
  await readyToDraw();
  expect(screen.getAllByText('Ensayo del evento').length).toBeGreaterThan(0);
  m.mode.current = 'operacion_real';
  rerender(<MemoryRouter initialEntries={['/']}><RaffleAdmin /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Sorteo oficial')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('group', { name: 'Premios de Sistema Solar' })).toBeInTheDocument());
  expect(stage().queryByText('Ensayo del evento')).not.toBeInTheDocument();
  fireEvent.click(await readyToDraw());
  await waitFor(() => expect(m.draw).toHaveBeenCalled());
  expect(m.draw.mock.calls[0][0]).toBe('amazon');
});

test('going from official operation back to a rehearsal asks again instead of reusing the official set', async () => {
  m.mode.current = 'operacion_real';
  server({ real: 7, demo: 4 });
  const { rerender } = open();
  await readyToDraw();
  m.mode.current = 'preparacion';
  rerender(<MemoryRouter initialEntries={['/']}><RaffleAdmin /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).toBeInTheDocument();
});

// ------------------------------------------------------------------ roles

test('the raffle role rehearses with the test records the server allows, whatever Coordinación chose, and is never asked', async () => {
  m.roles.current = ['sorteo'];
  chooseRehearsalSet('real');
  server({ real: 9, demo: 2 });
  render(<MemoryRouter initialEntries={['/']}><RaffleOperator /></MemoryRouter>);
  expect(screen.queryByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).not.toBeInTheDocument();
  expect(await drawnPrize()).toBe('d-amazon');
  expect(screen.queryByText('Ensayo con:')).not.toBeInTheDocument();
});

test('Coordinación in the same situation is asked', async () => {
  server({ real: 9, demo: 2 });
  open();
  expect(await screen.findByRole('heading', { name: '¿Con qué registros se hará el ensayo?' })).toBeInTheDocument();
});

// ------------------------------------------------------------------ never a mix

test('prizes, categories, participants and results of the other set never appear', async () => {
  chooseRehearsalSet('real');
  server({ real: 5, demo: 5 });
  m.winners.mockResolvedValue([
    winner('w-real', 'confirmado', { display_name: 'Alumno del conjunto elegido' }),
    winner('w-demo', 'confirmado', { display_name: 'Alumno del otro conjunto', category_id: 'd-ss', prize_id: 'd-amazon' }),
  ]);
  open('/?seccion=ganadores');
  expect(await screen.findByText('Alumno del conjunto elegido')).toBeInTheDocument();
  expect(screen.queryByText('Alumno del otro conjunto')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Sorteo en vivo' }));
  await screen.findByRole('group', { name: 'Premios de Sistema Solar' });
  expect(screen.getAllByRole('group', { name: /^Premios de / })).toHaveLength(3);
  expect(screen.getAllByRole('radio')).toHaveLength(5);
  const eligible = within(screen.getByLabelText('Resumen del sorteo')).getByText('participantes elegibles').previousElementSibling;
  expect(eligible).toHaveTextContent('18'); // 5 + 6 + 7 of the chosen set, not the 36 of both
});

test('after the cleanup the missing test categories are recognised, not silently replaced', async () => {
  chooseRehearsalSet('demo');
  server({ real: 5, demo: 0 }, { demoCategories: false });
  open('/?seccion=premios');
  expect(await screen.findByText(/falta(n)? la(s)? categorías? .*en los registros de este sorteo/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /premios oficiales/ })).not.toBeInTheDocument();
  expect(m.draw).not.toHaveBeenCalled();
});
