import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from './RaffleAdmin';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), save: vi.fn() }));

vi.mock('../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/raffleApi')>()),
  fetchOperatorView: m.view,
  fetchPrizes: m.prizes,
  fetchWinners: m.winners,
  saveCategory: m.save,
}));

const category = (id: string, name: string, sort_order: number, rules: object[], pool_count: number) => ({
  id, name, sort_order, rules, pool_count, is_active: true, is_demo: false, visual_config: {},
  required_academic: 0, required_leadership: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.prizes.mockResolvedValue([]);
  m.winners.mockResolvedValue([]);
  m.save.mockResolvedValue('id');
  m.view.mockResolvedValue({
    categories: [
      category('un', 'Universo', 30, [{ academic: 3, university_life: 1 }, { academic: 2, university_life: 2 }], 4),
      category('ga', 'Galaxia', 20, [{ academic: 2, university_life: 1 }, { total: 4 }], 1),
      category('ss', 'Sistema Solar', 10, [{ academic: 1, university_life: 1 }], 0),
    ],
    unassigned_combinations: [{ academic: 3, university_life: 0, count: 2 }, { academic: 1, university_life: 0, count: 1 }],
  });
});

test('lists the official categories with their alternatives in stamps and their candidates', async () => {
  render(<RaffleAdmin />);
  expect(await screen.findByText('Universo')).toBeInTheDocument();
  expect(screen.getByText(/3 académicos \+ 1 de Vida Universitaria, o 2 académicos \+ 2 de Vida Universitaria · 4 candidatos/)).toBeInTheDocument();
  expect(screen.getByText(/2 académicos \+ 1 de Vida Universitaria, o 4 sellos en total · 1 candidato$/)).toBeInTheDocument();
  expect(screen.getByText(/1 académico \+ 1 de Vida Universitaria · 0 candidatos/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/liderazgo|tickets/i);
});

test('shows the stamp combinations that do not reach any category yet', async () => {
  render(<RaffleAdmin />);
  expect(await screen.findByText('Sellos que todavía no alcanzan una categoría')).toBeInTheDocument();
  expect(screen.getByText('3 académicos + 0 de Vida Universitaria')).toBeInTheDocument();
  expect(screen.getByText('1 académico + 0 de Vida Universitaria')).toBeInTheDocument();
});

test('editing a category keeps every alternative and saves them as rules', async () => {
  render(<RaffleAdmin />);
  await screen.findByText('Galaxia');
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Alternativa 1 · 2 académicos \+ 1 de Vida Universitaria/)).toBeInTheDocument();
  expect(dialog.getByText(/o alternativa 2 · 4 sellos en total/)).toBeInTheDocument();

  // raise the total of the second alternative and add a third one
  fireEvent.change(dialog.getAllByLabelText('Total')[1], { target: { value: '5' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Agregar alternativa' }));
  fireEvent.change(dialog.getAllByLabelText('Vida Universitaria')[2], { target: { value: '3' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));

  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
  expect(m.save).toHaveBeenCalledWith({
    id: 'ga', name: 'Galaxia', sort_order: 20, is_active: true,
    rules: [{ academic: 2, university_life: 1 }, { total: 5 }, { university_life: 3 }],
  });
});

test('an alternative can be removed, but never the last one', async () => {
  render(<RaffleAdmin />);
  await screen.findByText('Galaxia');
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getAllByRole('button', { name: 'Quitar' })[0]);
  expect(dialog.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'ga', rules: [{ total: 4 }] })));
});
