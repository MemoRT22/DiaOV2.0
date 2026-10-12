import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import RaffleAdmin from '../RaffleAdmin';
import { category, OFFICIAL, prize } from './raffleFixtures';

const m = vi.hoisted(() => ({ view: vi.fn(), prizes: vi.fn(), winners: vi.fn(), save: vi.fn(), savePrize: vi.fn(), mode: { current: 'operacion_real' } }));

vi.mock('../../lib/raffleApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/raffleApi')>()),
  fetchOperatorView: m.view, fetchPrizes: m.prizes, fetchWinners: m.winners, saveCategory: m.save, savePrize: m.savePrize,
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: m.mode.current } }) }));

const PRIZES: Record<string, ReturnType<typeof prize>[]> = {
  un: [prize('tablet', 'un', 'Tablet', 3, 2, { description: 'Con funda' }), prize('audifonos', 'un', 'Audífonos', 1, 0)],
  ga: [prize('bocina', 'ga', 'Bocina', 5, 5, { is_active: false })],
  ss: [],
};

const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><RaffleAdmin /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  m.mode.current = 'operacion_real';
  m.prizes.mockImplementation(async (id: string) => PRIZES[id] ?? []);
  m.winners.mockResolvedValue([]);
  m.save.mockResolvedValue('id');
  m.savePrize.mockResolvedValue('id');
  m.view.mockResolvedValue({
    categories: OFFICIAL,
    unassigned_combinations: [{ academic: 3, university_life: 0, count: 2 }, { academic: 1, university_life: 0, count: 1 }],
  });
});

const card = (name: string) => within(screen.getByRole('article', { name: `Categoría ${name}` }));

test('opens on Preparación with the three sections and the summary of the environment', async () => {
  open();
  expect(await screen.findByRole('article', { name: 'Categoría Universo' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Preparación', 'Ejecutar sorteo', 'Historial']);
  expect(screen.getByRole('tab', { name: 'Preparación' })).toHaveAttribute('aria-selected', 'true');
  const stats = within(screen.getByLabelText('Resumen de la preparación'));
  expect(stats.getByText('categorías activas').previousElementSibling).toHaveTextContent('3');
  expect(stats.getByText('participantes elegibles').previousElementSibling).toHaveTextContent('5');
});

test('each category lists its alternatives, its candidates and its own prizes', async () => {
  open();
  await screen.findByText('Tablet');
  const universe = card('Universo');
  expect(universe.getByText('3 académicos + 1 de Vida Universitaria, o 2 académicos + 2 de Vida Universitaria')).toBeInTheDocument();
  expect(universe.getByText('4')).toBeInTheDocument();
  expect(universe.getByText('Tablet')).toBeInTheDocument();
  expect(universe.getByText('Con funda')).toBeInTheDocument();
  expect(universe.getByLabelText('2 de 3 disponibles')).toBeInTheDocument();
  expect(card('Galaxia').getByText('Bocina')).toBeInTheDocument();
  expect(card('Galaxia').queryByText('Tablet')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/liderazgo|tickets/i);
});

test('flags exhausted and inactive prizes and categories that have no prizes at all', async () => {
  open();
  await screen.findByText('Tablet');
  expect(card('Universo').getByText('Agotado')).toBeInTheDocument();
  expect(card('Galaxia').getByText('Inactivo')).toBeInTheDocument();
  expect(card('Sistema Solar').getByText('Sin premios.')).toBeInTheDocument();
  expect(screen.getByText(/Una categoría activa no tiene premios/)).toBeInTheDocument();
});

test('explains who is eligible: totals per category, what the rest still lacks and what the server does not expose yet', async () => {
  open();
  await screen.findByRole('article', { name: 'Categoría Universo' });
  expect(screen.getByText(/5 participantes compiten ahora en 3 categorías activas/)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Con sellos, pero sin categoría todavía/));
  expect(screen.getByText(/3 académicos \+ 0 de Vida Universitaria/)).toBeInTheDocument();
  expect(screen.getByText(/Te falta 1 sello de Vida Universitaria para Sistema Solar/)).toBeInTheDocument();
  expect(screen.getByText(/todavía no entrega la lista de elegibles/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Participantes' })).toHaveAttribute('href', '/coordinacion/participantes');
});

test('keeps real and demo categories in separate contexts and creates in the selected one', async () => {
  m.view.mockResolvedValue({ categories: [
    category('real', 'Universo', 10, [{ total: 3 }], 12),
    category('demo', 'Universo', 10, [{ total: 3 }], 2, { is_demo: true }),
  ], unassigned_combinations: [] });
  open();
  expect(await screen.findByRole('article', { name: 'Categoría Universo' })).toHaveTextContent('12');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('Datos reales', { selector: '.rf-env-title' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Datos de prueba' }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article', { name: 'Categoría Universo' })).toHaveTextContent('2');
  expect(screen.getByText('Datos de prueba', { selector: '.rf-env-title' })).toBeInTheDocument();
  expect(screen.getByText(/nada de esto cuenta para el evento/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Nueva categoría de prueba' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Estrella' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Estrella', is_demo: true })));
});

test('starts in the demo environment while the edition is still being prepared', async () => {
  m.mode.current = 'preparacion';
  m.view.mockResolvedValue({ categories: [category('real', 'Universo', 10, [{ total: 3 }], 12), category('demo', 'Estrella', 10, [{ total: 3 }], 2, { is_demo: true })], unassigned_combinations: [] });
  open();
  expect(await screen.findByRole('article', { name: 'Categoría Estrella' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Categoría Universo' })).not.toBeInTheDocument();
});

test('an empty environment offers to create the first category and shows nothing from the other one', async () => {
  m.view.mockResolvedValue({ categories: [category('real', 'Universo', 10, [{ total: 3 }], 12)], unassigned_combinations: [] });
  open();
  await screen.findByRole('article', { name: 'Categoría Universo' });
  fireEvent.click(screen.getByRole('button', { name: 'Datos de prueba' }));
  expect(screen.getByText('Sin categorías de prueba.')).toBeInTheDocument();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Nueva categoría' }).length).toBeGreaterThan(0);
});

test('adding a prize from a category preselects that category and saves it there', async () => {
  open();
  await screen.findByText('Bocina');
  fireEvent.click(card('Galaxia').getByRole('button', { name: '+ Agregar premio a Galaxia' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Nuevo premio' }));
  expect(dialog.getByRole('combobox', { name: 'Categoría' })).toHaveValue('ga');
  fireEvent.change(dialog.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Mochila' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.savePrize).toHaveBeenCalledWith(expect.objectContaining({ category_id: 'ga', name: 'Mochila', quantity: 1 })));
  expect(await screen.findByText('Premio guardado.')).toBeInTheDocument();
  await waitFor(() => expect(m.view).toHaveBeenCalledTimes(2)); // the pools and prizes are read again
});

test('editing a prize reuses its values', async () => {
  open();
  await screen.findByText('Tablet');
  fireEvent.click(card('Universo').getByRole('button', { name: 'Editar premio Tablet' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Editar premio' }));
  expect(dialog.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Tablet');
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.savePrize).toHaveBeenCalledWith(expect.objectContaining({ id: 'tablet', category_id: 'un', quantity: 3 })));
});

// ------------------------------------------------- category editor: alternatives in stamps

async function openEditor(name = 'Galaxia') {
  open();
  await screen.findByRole('article', { name: `Categoría ${name}` });
  fireEvent.click(screen.getByRole('button', { name: `Editar categoría ${name}` }));
  return within(screen.getByRole('dialog'));
}

test('editing a category keeps every alternative and saves them as rules', async () => {
  const dialog = await openEditor();
  expect(dialog.getByText(/Alternativa 1 · 2 académicos \+ 1 de Vida Universitaria/)).toBeInTheDocument();
  expect(dialog.getByText(/o alternativa 2 · 4 sellos en total/)).toBeInTheDocument();
  fireEvent.change(dialog.getAllByLabelText('Total')[1], { target: { value: '5' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Agregar alternativa' }));
  fireEvent.change(dialog.getAllByLabelText('Vida Universitaria')[2], { target: { value: '3' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
  expect(m.save).toHaveBeenCalledWith({
    id: 'ga', name: 'Galaxia', sort_order: 20, is_active: true, is_demo: false,
    rules: [{ academic: 2, university_life: 1 }, { total: 5 }, { university_life: 3 }],
  });
  expect(await screen.findByText('Categoría guardada.')).toBeInTheDocument();
});

test('an alternative can be removed, but never the last one', async () => {
  const dialog = await openEditor();
  fireEvent.click(dialog.getAllByRole('button', { name: 'Quitar' })[0]);
  expect(dialog.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'ga', rules: [{ total: 4 }] })));
});

const NO_REQUIREMENT = /Esta alternativa no pide ningún sello: dejaría entrar al sorteo a quien no tiene sellos\./;

test('a freshly added alternative is flagged, explained and cannot be saved until it asks for something', async () => {
  const dialog = await openEditor();
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Agregar alternativa' }));
  const added = within(dialog.getByRole('group', { name: 'Alternativa 3' }));
  expect(added.getByText(/o alternativa 3 · Sin requisitos/)).toBeInTheDocument();
  expect(added.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  expect(dialog.getByText('Completa o quita las alternativas marcadas para poder guardar.')).toBeInTheDocument();
  fireEvent.submit(dialog.getByRole('button', { name: 'Guardar' }).closest('form')!);
  expect(m.save).not.toHaveBeenCalled();
  fireEvent.change(added.getByLabelText('Académicos'), { target: { value: '0' } });
  fireEvent.change(added.getByLabelText('Total'), { target: { value: '0' } });
  expect(added.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  fireEvent.change(added.getByLabelText('Total'), { target: { value: '6' } });
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({
    id: 'ga', rules: [{ academic: 2, university_life: 1 }, { total: 4 }, { total: 6 }],
  })));
});

test('the only alternative of a category cannot be left without requirements', async () => {
  const dialog = await openEditor('Sistema Solar');
  const only = within(dialog.getByRole('group', { name: 'Alternativa 1' }));
  fireEvent.change(only.getByLabelText('Académicos'), { target: { value: '0' } });
  expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(only.getByLabelText('Vida Universitaria'), { target: { value: '' } });
  expect(only.getByRole('alert')).toHaveTextContent(NO_REQUIREMENT);
  expect(dialog.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Guardar' })).toBeDisabled();
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
  open();
  await screen.findByRole('article', { name: 'Categoría Galaxia' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Nueva categoría' })[0]);
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
