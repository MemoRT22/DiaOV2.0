import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { fetchDivisions } from '../../lib/catalog';
import DivisionsTab, { type DivisionDeletePreview } from './DivisionsTab';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { mode: 'preparacion' } }) }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchDivisions: vi.fn() }));

const DIVISIONS = [
  { id: 'd-salud', code: 'DIV-SALUD', name: 'Ciencias de la Salud', sort_order: 10, is_demo: false },
  { id: 'd-neg', code: 'DIV-NEGOCIOS', name: 'Negocios', sort_order: 20, is_demo: false },
];
const preview = (over: Partial<DivisionDeletePreview> = {}): DivisionDeletePreview => ({
  id: 'd-salud', code: 'DIV-SALUD', name: 'Ciencias de la Salud', is_demo: false, careers: 0, career_names: [],
  workshops_deleted: [], workshops_kept: 0, activities_unlinked: 0, participants_initial_interest: 0, participants_post_event_interest: 0, ...over,
});
let current: DivisionDeletePreview;

beforeEach(() => {
  vi.clearAllMocks();
  current = preview();
  vi.mocked(fetchDivisions).mockResolvedValue(DIVISIONS);
  vi.mocked(rpc).mockImplementation((async (name: string) => (name === 'division_delete_preview' ? current : name === 'save_division' ? 'd-new' : { deleted: true })) as never);
});
const confirmDeletion = (dialog: ReturnType<typeof within>) => {
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
};

test('every division can be created, edited and deleted from the list', async () => {
  render(<DivisionsTab />);
  expect(await screen.findByText('Ciencias de la Salud')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nueva división' })).toBeInTheDocument();
  for (const name of ['Ciencias de la Salud', 'Negocios']) {
    expect(screen.getByRole('button', { name: `Editar ${name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Eliminar ${name}` })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Nueva división' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Nombre'), { target: { value: 'Ingenierías' } });
  fireEvent.change(dialog.getByLabelText(/Código/), { target: { value: 'div-ing' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_division', { p: expect.objectContaining({ id: null, code: 'DIV-ING', name: 'Ingenierías' }) }));
});

test('an empty division is deleted after a typed confirmation and disappears from the list', async () => {
  render(<DivisionsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Ciencias de la Salud' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(rpc).toHaveBeenCalledWith('division_delete_preview', { p_id: 'd-salud' });
  expect(dialog.getByText('No tiene carreras, talleres ni intereses de alumnos asociados.')).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Eliminar definitivamente' })).toBeDisabled();
  expect(rpc).not.toHaveBeenCalledWith('delete_division', expect.anything());

  vi.mocked(fetchDivisions).mockResolvedValue([DIVISIONS[1]]);
  confirmDeletion(dialog);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('delete_division', { p_id: 'd-salud' }));
  expect(await screen.findByText('División «Ciencias de la Salud» eliminada.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Eliminar Ciencias de la Salud' })).not.toBeInTheDocument());
  expect(screen.getByText('Negocios')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a division with careers, workshops and student interests warns about each of them before confirming', async () => {
  current = preview({
    careers: 2, career_names: ['Medicina', 'Nutrición'],
    workshops_deleted: [
      { title: 'Taller de medicina', status: 'published', sessions: 4, reservations: 5, attendances: 2 },
      { title: 'RCP básico', status: 'submitted', sessions: 0, reservations: 0, attendances: 0 },
    ],
    workshops_kept: 3, activities_unlinked: 3, participants_initial_interest: 12, participants_post_event_interest: 1,
  });
  render(<DivisionsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Ciencias de la Salud' }));
  const dialog = within(await screen.findByRole('dialog'));
  const affected = within(dialog.getByRole('list', { name: 'Información relacionada que se verá afectada' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(affected).toEqual([
    'Se eliminan sus 2 carreras: Medicina, Nutrición.',
    'Se eliminan 2 talleres que solo pertenecen a esta división, con 5 reservaciones y 2 asistencias: Taller de medicina, RCP básico.',
    '3 talleres compartidos se conservan con sus otras divisiones; solo pierden las carreras de esta.',
    '12 alumnos dejan de tener como carrera de interés inicial una de esta división.',
    '1 alumno pierde carreras de esta división entre sus intereses posteriores.',
  ]);
  expect(dialog.getByText('Las demás divisiones, sus carreras y sus talleres no cambian.')).toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalledWith('delete_division', expect.anything());
});

test('singular wording for one career, one workshop and one shared workshop', async () => {
  current = preview({ careers: 1, career_names: ['Medicina'], workshops_kept: 1,
    workshops_deleted: [{ title: 'Taller de medicina', status: 'published', sessions: 2, reservations: 0, attendances: 0 }] });
  render(<DivisionsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Ciencias de la Salud' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('Se eliminan sus 1 carrera: Medicina.')).toBeInTheDocument();
  expect(dialog.getByText('Se elimina 1 taller que solo pertenece a esta división: Taller de medicina.')).toBeInTheDocument();
  expect(dialog.getByText('1 taller compartido se conserva con sus otras divisiones; solo pierde las carreras de esta.')).toBeInTheDocument();
});

test('cancelling deletes nothing; a server error is shown and the division stays', async () => {
  render(<DivisionsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Negocios' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalledWith('delete_division', expect.anything());

  vi.mocked(rpc).mockImplementation((async (name: string) => {
    if (name === 'division_delete_preview') return current;
    throw new Error('NOT_AUTHORIZED');
  }) as never);
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Negocios' }));
  const dialog = within(await screen.findByRole('dialog'));
  confirmDeletion(dialog);
  expect(await dialog.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByText('Negocios')).toBeInTheDocument();
  expect(screen.queryByText(/eliminada\./)).not.toBeInTheDocument();
});

test('a failed preview opens no confirmation', async () => {
  vi.mocked(rpc).mockRejectedValue(new Error('NOT_FOUND'));
  render(<DivisionsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Negocios' }));
  expect(await screen.findByText('No se encontró el elemento.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
