import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { AMAZON, category, MACBOOK, officialPrizes, OFFICIAL, winner } from './raffleFixtures';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), invalidate: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, invalidateWinner: m.invalidate, fetchPendingSelection: async () => ({ winner_id: null }),
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));

const open = () => render(<MemoryRouter initialEntries={['/?seccion=ganadores']}><RaffleAdmin /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  // the other set of records (test flag) is in the same answer and must never show up here
  m.view.mockImplementation(async () => structuredClone({ categories: [...OFFICIAL, category('d', 'Universo', 10, [{ total: 3 }], 1, { is_demo: true })], unassigned_combinations: [] }));
  m.prizes.mockImplementation(async (id: string) => (officialPrizes() as Record<string, unknown[]>)[id] ?? []);
  m.invalidate.mockResolvedValue({ winner_id: 'w1', status: 'invalidado' });
  m.winners.mockResolvedValue([
    winner('w1', 'confirmado'),
    winner('w2', 'seleccionado', { display_name: 'Luis Pérez', prize_id: 'macbook', prize_name: MACBOOK, category_id: 'un', category_name: 'Universo' }),
    winner('w3', 'no_presentado', { display_name: 'Marta Ruiz' }),
    winner('w4', 'invalidado', { display_name: 'Pablo Gil', invalidation_reason: 'Se fue antes de recoger' }),
    winner('w5', 'confirmado', { display_name: 'Participante de prueba', category_id: 'd', category_name: 'Universo' }),
  ]);
});

test('lists each winner with prize, category, date and the delivery state in plain words', async () => {
  open();
  const row = (await screen.findByText('Ana López')).closest('.ad-data-row') as HTMLElement;
  expect(within(row).getByText(`${AMAZON} · Sistema Solar`)).toBeInTheDocument();
  expect(within(row).getByText('Entregado')).toBeInTheDocument();
  expect(within(row).getByText(/22 oct 2026/)).toBeInTheDocument();
  expect(screen.getByText('Por confirmar', { selector: '.badge' })).toBeInTheDocument();
  expect(screen.getByText('No se presentó', { selector: '.badge' })).toBeInTheDocument();
  expect(screen.getByText('Motivo: Se fue antes de recoger')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/seleccionado|confirmado\b|no_presentado|invalidado\b/);
  expect(screen.queryByRole('button', { name: /Sortear/ })).not.toBeInTheDocument();
});

test('only the results of the set of records in use are shown, never a mix', async () => {
  open();
  await screen.findByText('Ana López');
  expect(screen.queryByText('Participante de prueba')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Datos de prueba|Datos reales/ })).not.toBeInTheDocument();
});

test('filters in plain groups and says so when nothing matches', async () => {
  open();
  await screen.findByText('Ana López');
  fireEvent.click(screen.getByRole('button', { name: 'No entregados' }));
  expect(screen.getByText('Pablo Gil')).toBeInTheDocument();
  expect(screen.getByText('Marta Ruiz')).toBeInTheDocument();
  expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Por confirmar' }));
  expect(screen.getByText('Luis Pérez')).toBeInTheDocument();
  expect(screen.queryByText('Marta Ruiz')).not.toBeInTheDocument();
});

test('summarises what was delivered and what is waiting', async () => {
  open();
  await screen.findByText('Ana López');
  const stats = within(screen.getByLabelText('Resumen de resultados'));
  expect(stats.getByText('premio entregado').previousElementSibling).toHaveTextContent('1');
  expect(stats.getByText('por confirmar').previousElementSibling).toHaveTextContent('1');
  expect(stats.getByText('resultados en total').previousElementSibling).toHaveTextContent('4');
});

test('shows an empty history', async () => {
  m.winners.mockResolvedValue([]);
  open();
  expect(await screen.findByText('Todavía no hay ganadores.')).toBeInTheDocument();
});

test('Coordinación can invalidate a delivered prize with a reason, and the list refreshes', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Invalidar a Ana López' }));
  expect(screen.queryByRole('button', { name: 'Invalidar a Luis Pérez' })).not.toBeInTheDocument(); // only delivered ones
  const dialog = within(screen.getByRole('dialog', { name: 'Invalidar ganador' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'No era elegible' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Invalidar' }));
  await waitFor(() => expect(m.invalidate).toHaveBeenCalledWith('w1', 'No era elegible'));
  expect(await screen.findByText(/Resultado invalidado\. El premio volvió a quedar disponible/)).toBeInTheDocument();
  await waitFor(() => expect(m.winners.mock.calls.length).toBeGreaterThan(1));
});

test('a failed read of the results is explained instead of showing an empty list', async () => {
  m.winners.mockRejectedValue(new Error('NETWORK'));
  open();
  expect(await screen.findByText(/No se pudieron consultar los resultados/)).toBeInTheDocument();
  expect(screen.queryByText('Todavía no hay ganadores.')).not.toBeInTheDocument();
});
