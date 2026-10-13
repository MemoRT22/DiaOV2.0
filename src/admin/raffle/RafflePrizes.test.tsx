import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { AMAZON, category, IPAD, MACBOOK, OFFICIAL, prize, SWITCH, WATCH, winner } from './raffleFixtures';

type Row = ReturnType<typeof prize>;
const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), save: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, savePrize: m.save,
  fetchPendingSelection: async () => ({ winner_id: null }),
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));

let rows: Row[];
let ids = 0;
let failOnSave: number | null = null;
let saves = 0;
const open = () => render(<MemoryRouter initialEntries={['/?seccion=premios']}><RaffleAdmin /></MemoryRouter>);
const card = (name: string) => within(screen.getByRole('article', { name: `Categoría ${name}` }));

/** The server: it keeps the prizes, and `save_raffle_prize` creates or updates them. Nothing else can write. */
beforeEach(() => {
  vi.clearAllMocks();
  rows = []; ids = 0; failOnSave = null; saves = 0;
  m.view.mockImplementation(async () => structuredClone({ categories: OFFICIAL, unassigned_combinations: [] }));
  m.winners.mockResolvedValue([]);
  m.prizes.mockImplementation(async (categoryId: string) => structuredClone(rows.filter((row) => row.category_id === categoryId)));
  m.save.mockImplementation(async (params: { id?: string; category_id: string; name: string; quantity: number; is_active: boolean; sort_order: number; description?: string }) => {
    saves += 1;
    if (failOnSave === saves) throw new Error('NETWORK');
    if (params.id) {
      const row = rows.find((r) => r.id === params.id)!;
      Object.assign(row, { name: params.name, quantity: params.quantity, is_active: params.is_active, available: params.quantity - row.delivered });
      return params.id;
    }
    const row = prize(`n${++ids}`, params.category_id, params.name, params.quantity, params.quantity, { is_active: params.is_active, sort_order: params.sort_order });
    rows.push(row);
    return row.id;
  });
});

test('shows the three official categories with 3, 3 and 10 prizes, and 16 in total, with no forms to create anything', async () => {
  open();
  await screen.findByRole('article', { name: 'Categoría Universo' });
  expect(card('Universo').getByText('3 premios · 2 tipos')).toBeInTheDocument();
  expect(card('Galaxia').getByText('3 premios · 2 tipos')).toBeInTheDocument();
  expect(card('Sistema Solar').getByText('10 premios · 1 tipo')).toBeInTheDocument();
  expect(within(screen.getByLabelText('Resumen de premios')).getByText(/premios oficiales en 3 categorías/).previousElementSibling).toHaveTextContent('16');
  expect(screen.queryByRole('button', { name: /Nueva categoría|Nuevo premio|Agregar premio|Editar/ })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/sort_order|requisitos configurables/i);
});

test('each prize is in its own category with its literal specification', async () => {
  open();
  await screen.findByRole('article', { name: 'Categoría Universo' });
  expect(card('Universo').getByText(MACBOOK)).toBeInTheDocument();
  expect(card('Universo').getByText(IPAD)).toBeInTheDocument();
  expect(card('Galaxia').getByText(WATCH)).toBeInTheDocument();
  expect(card('Galaxia').getByText(SWITCH)).toBeInTheDocument();
  expect(card('Sistema Solar').getByText(AMAZON)).toBeInTheDocument();
  expect(card('Universo').queryByText(AMAZON)).not.toBeInTheDocument();
});

test('before the catalog is registered it says so and offers ONE clear action; opening the screen writes nothing', async () => {
  open();
  expect(await screen.findByText('Los premios oficiales todavía no están registrados')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /premios oficiales/ })).toHaveLength(1);
  expect(screen.getAllByText('Pendiente')).toHaveLength(5);
  expect(card('Sistema Solar').getByText(/10 unidades · por registrar/)).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(m.save).not.toHaveBeenCalled();
});

test('preparing registers the five prizes (16 units) with the existing save, shows the plan first and confirms', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar premios oficiales' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Preparar premios oficiales' }));
  expect(dialog.getAllByRole('listitem')).toHaveLength(5);
  expect(dialog.getByText(/No se borra nada/)).toBeInTheDocument();
  expect(m.save).not.toHaveBeenCalled(); // seeing the plan changes nothing
  fireEvent.click(dialog.getByRole('button', { name: 'Preparar' }));
  expect(await screen.findByText(/Premios oficiales listos: 5 registrados/)).toBeInTheDocument();
  expect(m.save).toHaveBeenCalledTimes(5);
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'ss', name: AMAZON, quantity: 10, is_active: true }));
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'un', name: IPAD, quantity: 2 }));
  expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(16);
  expect(await screen.findByText('Los premios oficiales están registrados.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /premios oficiales/ })).not.toBeInTheDocument();
  expect(card('Sistema Solar').getByText('0 de 10 entregadas')).toBeInTheDocument();
});

test('preparing twice never duplicates: the second time there is nothing to do and nothing is written', async () => {
  rows = [
    prize('a', 'un', MACBOOK, 1, 1), prize('b', 'un', IPAD, 2, 2), prize('c', 'ga', WATCH, 1, 1), prize('d', 'ga', SWITCH, 2, 2), prize('e', 'ss', AMAZON, 10, 10),
  ];
  open();
  expect(await screen.findByText('Los premios oficiales están registrados.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /premios oficiales/ })).not.toBeInTheDocument();
  expect(m.save).not.toHaveBeenCalled();
  expect(rows).toHaveLength(5);
});

test('a partly prepared catalog is completed without duplicating what is already there', async () => {
  rows = [prize('e', 'ss', AMAZON, 10, 7, { delivered: 3 }), prize('a', 'un', MACBOOK.toLowerCase(), 1, 1)];
  open();
  expect(await screen.findByText(/Faltan 3 premios por registrar/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar premios oficiales' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(dialog.getByRole('button', { name: 'Preparar' }));
  await screen.findByText(/Premios oficiales listos: 3 registrados/);
  expect(m.save).toHaveBeenCalledTimes(3);
  expect(rows).toHaveLength(5);
  expect(rows.find((row) => row.id === 'e')).toMatchObject({ quantity: 10, delivered: 3 }); // what was delivered is untouched
});

test('if preparing fails half way it says what is already in place and resumes without duplicates', async () => {
  failOnSave = 3;
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Preparar premios oficiales' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preparar' }));
  expect(await screen.findByText(/No se pudo terminar/)).toBeInTheDocument();
  expect(screen.getByText(/Ya quedaron 2 premios\./)).toBeInTheDocument();
  expect(rows).toHaveLength(2);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText(/Premios oficiales listos: 3 registrados/)).toBeInTheDocument();
  expect(rows).toHaveLength(5);
  expect(new Set(rows.map((row) => `${row.category_id}|${row.name}`)).size).toBe(5);
});

test('delivered and still-to-draw units come from the server, per prize', async () => {
  rows = [
    prize('a', 'un', MACBOOK, 1, 1), prize('b', 'un', IPAD, 2, 1), prize('c', 'ga', WATCH, 1, 0), prize('d', 'ga', SWITCH, 2, 2), prize('e', 'ss', AMAZON, 10, 7),
  ];
  m.winners.mockResolvedValue([
    winner('w1', 'confirmado', { prize_id: 'b', prize_name: IPAD, category_id: 'un', category_name: 'Universo' }),
    winner('w2', 'confirmado', { prize_id: 'c', prize_name: WATCH, category_id: 'ga', category_name: 'Galaxia' }),
    ...[3, 4, 5].map((n) => winner(`w${n}`, 'confirmado', { prize_id: 'e' })),
  ]);
  open();
  await screen.findByText('3 de 10 entregadas');
  expect(card('Sistema Solar').getByLabelText('7 por sortear de 10')).toBeInTheDocument();
  expect(card('Universo').getByText('1 de 2 entregadas')).toBeInTheDocument();
  expect(card('Galaxia').getByText('1 de 1 entregado')).toBeInTheDocument();
  const stats = within(screen.getByLabelText('Resumen de premios'));
  expect(stats.getByText(/entregados/).previousElementSibling).toHaveTextContent('5');
  expect(stats.getByText('por sortear').previousElementSibling).toHaveTextContent('11');
});

test('a prize waiting for confirmation is shown as such, not as delivered', async () => {
  rows = [prize('a', 'un', MACBOOK, 1, 0), prize('b', 'un', IPAD, 2, 2), prize('c', 'ga', WATCH, 1, 1), prize('d', 'ga', SWITCH, 2, 2), prize('e', 'ss', AMAZON, 10, 10)];
  m.winners.mockResolvedValue([winner('w1', 'seleccionado', { prize_id: 'a', prize_name: MACBOOK, category_id: 'un', category_name: 'Universo' })]);
  open();
  expect(await screen.findByText(/0 de 1 entregado · 1 pendiente de confirmar/)).toBeInTheDocument();
});

test('older prizes outside the catalog are reported, not offered, not deleted', async () => {
  rows = [prize('a', 'un', MACBOOK, 1, 1), prize('x', 'ss', 'Premio de prueba', 5, 5, { delivered: 0 }), prize('y', 'ss', 'Bocina vieja', 2, 1, { delivered: 1 })];
  open();
  const note = await screen.findByText(/Premios anteriores que no forman parte del catálogo oficial · 2/);
  fireEvent.click(note);
  expect(screen.getByText(/Nada se elimina automáticamente/)).toBeInTheDocument();
  expect(screen.getByText('Premio de prueba')).toBeInTheDocument();
  expect(screen.getByText('Bocina vieja')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar premios oficiales' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preparar' }));
  await screen.findByText(/Premios oficiales listos/);
  expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining(['x', 'y']));
  expect(rows).toHaveLength(3 + 4);
});

test('a wrong quantity is put right, but never below what was already committed', async () => {
  rows = [prize('a', 'un', MACBOOK, 3, 3), prize('b', 'un', IPAD, 2, 2), prize('c', 'ga', WATCH, 1, 1), prize('d', 'ga', SWITCH, 5, 2, { delivered: 3 }), prize('e', 'ss', AMAZON, 10, 10)];
  open();
  expect(await screen.findByText(/1 premio por corregir/)).toBeInTheDocument();
  expect(screen.getByText(/1 premio tiene más entregas que la cantidad oficial/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Completar premios oficiales' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preparar' }));
  expect(await screen.findByText(/Premios oficiales preparados: 1 corregido/)).toBeInTheDocument();
  expect(rows.find((row) => row.id === 'a')!.quantity).toBe(1);
  expect(rows.find((row) => row.id === 'd')!.quantity).toBe(5); // 3 delivered > 2 official: left alone
});

test('if a category is missing from the records it says exactly that and does not pretend to prepare anything', async () => {
  m.view.mockImplementation(async () => structuredClone({ categories: OFFICIAL.filter((c) => c.id !== 'ga'), unassigned_combinations: [] }));
  open();
  expect(await screen.findByText(/falta la categoría Galaxia/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /premios oficiales/ })).not.toBeInTheDocument();
  expect(card('Galaxia').getAllByText(/por registrar/).length).toBe(2);
});

test('explains in plain words who takes part in each category, without editable requirements', async () => {
  open();
  await screen.findByRole('article', { name: 'Categoría Universo' });
  expect(card('Universo').getByText(/3 académicos \+ 1 de Vida Universitaria, o 2 académicos \+ 2 de Vida Universitaria/)).toBeInTheDocument();
  expect(card('Galaxia').getByText(/2 académicos \+ 1 de Vida Universitaria, o 4 sellos en total/)).toBeInTheDocument();
  expect(card('Sistema Solar').getByText(/1 académico \+ 1 de Vida Universitaria/)).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});

test('the technical details are folded away and name the set of records in use', async () => {
  m.view.mockImplementation(async () => structuredClone({ categories: [...OFFICIAL, category('d', 'Universo', 10, [{ total: 3 }], 0, { is_demo: true })], unassigned_combinations: [] }));
  open();
  const details = (await screen.findByText('Detalles técnicos')).closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent(/oficiales \(no is_demo\)/);
  expect(screen.getAllByRole('article')).toHaveLength(3); // never a duplicated category
});

test('if another window of this browser is preparing the catalog, this one writes nothing and says so; afterwards it can continue', async () => {
  let held = true;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => callback(held ? null : {}) },
  });
  try {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar premios oficiales' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preparar' }));
    expect(await screen.findByText(/Otra ventana de este navegador está preparando los premios/)).toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    held = false; // the other window finished
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preparar' }));
    expect(await screen.findByText(/Premios oficiales listos: 5 registrados/)).toBeInTheDocument();
    expect(rows).toHaveLength(5);
  } finally {
    Reflect.deleteProperty(navigator, 'locks');
  }
});
