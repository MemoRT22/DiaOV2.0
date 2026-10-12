import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { category, OFFICIAL, winner } from './raffleFixtures';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), invalidate: vi.fn() }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, invalidateWinner: m.invalidate,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));

const open = () => render(<MemoryRouter initialEntries={['/?seccion=historial']}><RaffleAdmin /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  m.view.mockImplementation(async () => structuredClone({ categories: [...OFFICIAL, category('d', 'Universo', 10, [{ total: 3 }], 1, { is_demo: true })], unassigned_combinations: [] }));
  m.prizes.mockResolvedValue([]);
  m.invalidate.mockResolvedValue({ winner_id: 'w1', status: 'invalidado' });
  m.winners.mockResolvedValue([
    winner('w1', 'confirmado'),
    winner('w2', 'seleccionado', { display_name: 'Luis Pérez' }),
    winner('w3', 'no_presentado', { display_name: 'Marta Ruiz' }),
    winner('w4', 'invalidado', { display_name: 'Pablo Gil', invalidation_reason: 'Se fue antes de recoger' }),
    winner('w5', 'confirmado', { display_name: 'Participante de prueba', category_id: 'd', category_name: 'Universo' }),
  ]);
});

test('lists each result with prize, category, date and a readable status, separate from the draw', async () => {
  open();
  const row = (await screen.findByText('Ana López')).closest('.ad-data-row') as HTMLElement;
  expect(within(row).getByText('Tablet · Universo')).toBeInTheDocument();
  expect(within(row).getByText('Confirmado')).toBeInTheDocument();
  expect(within(row).getByText(/22 oct 2026/)).toBeInTheDocument();
  expect(screen.getByText('Pendiente de confirmar')).toBeInTheDocument();
  expect(screen.getByText('No se presentó', { selector: '.badge' })).toBeInTheDocument();
  expect(screen.getByText('Motivo de invalidación: Se fue antes de recoger')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Sortear/ })).not.toBeInTheDocument();
});

test('only shows the results of the visible environment', async () => {
  open();
  await screen.findByText('Ana López');
  expect(screen.queryByText('Participante de prueba')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Datos de prueba' }));
  expect(screen.getByText('Participante de prueba')).toBeInTheDocument();
  expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
});

test('filters by status and says so when nothing matches', async () => {
  open();
  await screen.findByText('Ana López');
  fireEvent.click(screen.getByRole('button', { name: 'Invalidados' }));
  expect(screen.getByText('Pablo Gil')).toBeInTheDocument();
  expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  m.winners.mockResolvedValue([winner('w1', 'confirmado')]);
  fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
  expect(screen.getByText('Ana López')).toBeInTheDocument();
});

test('summarises confirmed, pending and lost results', async () => {
  open();
  await screen.findByText('Ana López');
  const stats = within(screen.getByLabelText('Resumen de resultados'));
  expect(stats.getByText('premio confirmado').previousElementSibling).toHaveTextContent('1');
  expect(stats.getByText(/pendiente de confirmar/).previousElementSibling).toHaveTextContent('1');
  expect(stats.getByText('no se presentaron o se invalidaron').previousElementSibling).toHaveTextContent('2');
});

test('shows an empty history', async () => {
  m.winners.mockResolvedValue([]);
  open();
  expect(await screen.findByText('Sin ganadores registrados.')).toBeInTheDocument();
});

test('Coordinación can invalidate a confirmed prize with a reason, and the list refreshes', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Invalidar a Ana López' }));
  expect(screen.queryByRole('button', { name: 'Invalidar a Luis Pérez' })).not.toBeInTheDocument(); // only confirmed ones
  const dialog = within(screen.getByRole('dialog', { name: 'Invalidar ganador' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'No era elegible' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Invalidar' }));
  await waitFor(() => expect(m.invalidate).toHaveBeenCalledWith('w1', 'No era elegible'));
  expect(await screen.findByText(/Ganador invalidado\. El premio volvió al inventario/)).toBeInTheDocument();
  await waitFor(() => expect(m.winners).toHaveBeenCalledTimes(2));
});

test('a failed load explains itself and keeps the page usable', async () => {
  m.winners.mockRejectedValue(new Error('NETWORK'));
  open();
  expect(await screen.findByText('No hay conexión. Revisa tu internet e inténtalo de nuevo.')).toBeInTheDocument();
  expect(screen.getByText('Sin ganadores registrados.')).toBeInTheDocument();
});
