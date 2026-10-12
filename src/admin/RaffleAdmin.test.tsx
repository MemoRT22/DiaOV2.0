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
vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'operacion_real' } }) }));

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
  const universe = within(screen.getByText('Universo').closest('.ad-data-row')!);
  expect(universe.getByText('3 académicos + 1 de Vida Universitaria, o 2 académicos + 2 de Vida Universitaria')).toBeInTheDocument();
  expect(universe.getByText('4')).toBeInTheDocument();
  expect(screen.getByText('2 académicos + 1 de Vida Universitaria, o 4 sellos en total')).toBeInTheDocument();
  expect(screen.getByText('1 académico + 1 de Vida Universitaria')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/liderazgo|tickets/i);
});

test('shows the stamp combinations that do not reach any category yet', async () => {
  render(<RaffleAdmin />);
  fireEvent.click(await screen.findByText(/Sellos que todavía no alcanzan una categoría/));
  expect(screen.getByText(/3 académicos \+ 0 de Vida Universitaria/)).toBeInTheDocument();
  expect(screen.getByText(/1 académico \+ 0 de Vida Universitaria/)).toBeInTheDocument();
});

test('keeps real and demo categories in separate contexts and creates in the selected one', async () => {
  m.view.mockResolvedValue({ categories: [
    category('real', 'Universo', 10, [{ total: 3 }], 12),
    { ...category('demo', 'Universo', 10, [{ total: 3 }], 2), is_demo: true },
  ], unassigned_combinations: [] });
  render(<RaffleAdmin />);
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(screen.getAllByText('Universo')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Datos de prueba' }));
  expect(screen.getAllByText('Universo')).toHaveLength(1);
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.queryByText('12')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Nueva categoría de prueba' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Estrella' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Estrella', is_demo: true })));
});

test('selects the first new demo category for prizes after creating it in an empty demo scope', async () => {
  const real = category('real', 'Universo', 10, [{ total: 3 }], 12);
  const demo = { ...category('demo', 'Universo', 10, [{ total: 3 }], 0), is_demo: true };
  m.view.mockResolvedValue({ categories: [real], unassigned_combinations: [] });
  m.save.mockImplementation(async () => {
    m.view.mockResolvedValue({ categories: [real, demo], unassigned_combinations: [] });
    return demo.id;
  });
  render(<RaffleAdmin />);
  await screen.findByText('12');
  fireEvent.click(screen.getByRole('button', { name: 'Datos de prueba' }));
  expect(screen.getByText('Sin categorías de prueba.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Universo' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await screen.findByText('Categoría guardada.');
  fireEvent.click(screen.getByRole('tab', { name: 'Premios' }));
  await waitFor(() => expect(m.prizes).toHaveBeenCalledWith('demo'));
  expect(screen.getByRole('combobox', { name: 'Categoría' })).toHaveValue('demo');
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
    id: 'ga', name: 'Galaxia', sort_order: 20, is_active: true, is_demo: false,
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

// ------------------------------------------------- alternatives must ask for at least one stamp

const NO_REQUIREMENT = /Esta alternativa no pide ningún sello: dejaría entrar al sorteo a quien no tiene sellos\./;

async function openEditor(index = 1) {
  render(<RaffleAdmin />);
  await screen.findByText('Galaxia');
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[index]);
  return within(screen.getByRole('dialog'));
}

test('a freshly added alternative is flagged, explained and cannot be saved until it asks for something', async () => {
  const dialog = await openEditor();
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeEnabled();

  fireEvent.click(dialog.getByRole('button', { name: 'Agregar alternativa' }));
  const added = within(dialog.getByRole('group', { name: 'Alternativa 3' }));
  expect(added.getByText(/o alternativa 3 · Sin requisitos/)).toBeInTheDocument();
  expect(added.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.getAllByRole('alert')).toHaveLength(1); // the official alternatives stay valid
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  expect(dialog.getByText('Completa o quita las alternativas marcadas para poder guardar.')).toBeInTheDocument();

  // even a forced submit (Enter in a field) does not reach the server
  fireEvent.submit(dialog.getByRole('button', { name: 'Guardar' }).closest('form')!);
  expect(m.save).not.toHaveBeenCalled();

  // zeros are still «nothing»
  fireEvent.change(added.getByLabelText('Académicos'), { target: { value: '0' } });
  fireEvent.change(added.getByLabelText('Total'), { target: { value: '0' } });
  expect(added.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();

  // one positive minimum makes it a real alternative
  fireEvent.change(added.getByLabelText('Total'), { target: { value: '6' } });
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  expect(added.getByText(/o alternativa 3 · 6 sellos en total/)).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
  expect(m.save).toHaveBeenCalledWith(expect.objectContaining({
    id: 'ga', rules: [{ academic: 2, university_life: 1 }, { total: 4 }, { total: 6 }],
  }));
});

test('emptying an existing alternative is flagged; removing it makes the category savable again', async () => {
  const dialog = await openEditor();
  const second = within(dialog.getByRole('group', { name: 'Alternativa 2' }));
  fireEvent.change(second.getByLabelText('Total'), { target: { value: '' } });
  expect(second.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();

  fireEvent.click(second.getByRole('button', { name: 'Quitar' }));
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'ga', rules: [{ academic: 2, university_life: 1 }] })));
});

test('the only alternative of a category cannot be left without requirements', async () => {
  const dialog = await openEditor(2); // Sistema Solar: 1 + 1
  const only = within(dialog.getByRole('group', { name: 'Alternativa 1' }));
  fireEvent.change(only.getByLabelText('Académicos'), { target: { value: '0' } });
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument(); // still asks for 1 de Vida Universitaria
  fireEvent.change(only.getByLabelText('Vida Universitaria'), { target: { value: '' } });
  expect(only.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  expect(m.save).not.toHaveBeenCalled();
});

test('values that are not whole numbers between 0 and 999 are explained too', async () => {
  const dialog = await openEditor();
  const first = within(dialog.getByRole('group', { name: 'Alternativa 1' }));
  for (const bad of ['1.5', '-2', '1000']) {
    fireEvent.change(first.getByLabelText('Académicos'), { target: { value: bad } });
    expect(first.getByRole('alert')).toHaveTextContent('Usa números enteros entre 0 y 999.');
    expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  }
  fireEvent.change(first.getByLabelText('Académicos'), { target: { value: '3' } });
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
});

test('a new category starts with a valid alternative', async () => {
  render(<RaffleAdmin />);
  await screen.findByText('Galaxia');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Alternativa 1 · 1 académico \+ 1 de Vida Universitaria/)).toBeInTheDocument();
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
});

test('the server has the last word: its rejection is shown and the editor stays open', async () => {
  m.save.mockRejectedValue(new Error('INVALID_REQUIREMENTS'));
  const dialog = await openEditor();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  expect(await dialog.findByText(/cada alternativa debe pedir al menos un sello/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByText('Categoría guardada.')).not.toBeInTheDocument();
});
