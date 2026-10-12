import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi, type LegacyWorkshop, type WorkshopList } from '../../lib/workshopAdminApi';
import WorkshopInbox from './WorkshopInbox';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { list: vi.fn(), listLegacy: vi.fn(), removeLegacy: vi.fn(), remove: vi.fn() },
}));

const EMPTY: WorkshopList = { items: [], total: 0, page: 1, page_size: 25, counts: { pending: 0, published: 0, archived: 0 } };
const legacy = (over: Partial<LegacyWorkshop>): LegacyWorkshop => ({
  activity_id: 'a-1', title: 'Taller Académico A', activity_type: 'academica', experience_category: null, is_demo: true,
  location: 'Sala DEMO', created_at: '2026-10-04T10:00:00Z', division_names: ['División Demo'],
  sessions: [{ id: 's-1', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z', capacity: 30, reserved: 2, status: 'activa' }],
  dependents: { sessions: 1, reservations: 3, attendances: 2, participants: 3 }, ...over,
});
const ITEMS = [
  legacy({}),
  legacy({ activity_id: 'a-2', title: 'Taller de Liderazgo', activity_type: 'liderazgo', dependents: { sessions: 1, reservations: 0, attendances: 0, participants: 0 } }),
  legacy({ activity_id: 'a-3', title: 'CERT DEMO Vida', activity_type: 'vida_universitaria', experience_category: 'otra', division_names: [], location: null, sessions: [],
    dependents: { sessions: 0, reservations: 0, attendances: 0, participants: 0 } }),
];
const show = () => render(<MemoryRouter initialEntries={['/coordinacion/talleres']}><Routes>
  <Route path="/coordinacion/talleres" element={<WorkshopInbox />} />
</Routes></MemoryRouter>);
const section = async () => within(await screen.findByRole('region', { name: 'Talleres sin expediente' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workshopAdminApi.list).mockResolvedValue(EMPTY);
  vi.mocked(workshopAdminApi.listLegacy).mockResolvedValue(ITEMS);
});

test('workshops without a file are listed in Talleres with what is needed to consult them', async () => {
  show();
  const s = await section();
  expect(s.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Taller Académico A', 'Taller de Liderazgo', 'CERT DEMO Vida']);
  const first = within(s.getByRole('heading', { level: 3, name: 'Taller Académico A' }).closest('li')!);
  expect(first.getByText('Taller académico')).toBeInTheDocument();
  expect(first.getByText('División Demo · Sala DEMO')).toBeInTheDocument();
  expect(first.getByText('Prueba')).toBeInTheDocument();
  expect(first.getByText('Sin expediente')).toBeInTheDocument();
  expect(first.getByText('1 horario · 3 reservaciones · 2 asistencias')).toBeInTheDocument();
  expect(first.getByText(/Cupo 30 · Reservados 2 · Disponible/)).toBeInTheDocument();
  // other kinds keep their own labels; one without division or sessions still renders
  expect(within(s.getByRole('heading', { level: 3, name: 'Taller de Liderazgo' }).closest('li')!).getByText('Liderazgo (tipo anterior)')).toBeInTheDocument();
  const life = within(s.getByRole('heading', { level: 3, name: 'CERT DEMO Vida' }).closest('li')!);
  expect(life.getByText('Vida Universitaria · Otra')).toBeInTheDocument();
  expect(life.getByText('Sin división')).toBeInTheDocument();
  expect(life.queryByText('Ver horarios')).not.toBeInTheDocument();
});

test('each one can be deleted individually, with its related data spelled out and a typed confirmation', async () => {
  vi.mocked(workshopAdminApi.removeLegacy).mockResolvedValue({ activity_id: 'a-1', deleted: true, removed: { sessions: 1, reservations: 3, attendances: 2, participants: 3 } });
  show();
  const s = await section();
  fireEvent.click(s.getByRole('button', { name: 'Eliminar taller Taller Académico A' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(within(dialog.getByRole('list', { name: 'Datos que se eliminarán' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    '1 horario y su código QR de asistencia', '3 reservaciones', '2 asistencias registradas, con los sellos que otorgaron',
  ]);
  expect(dialog.getByText('3 alumnos perderán su reservación o sus sellos de este taller.')).toBeInTheDocument();
  const confirm = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  expect(confirm).toBeDisabled();
  expect(workshopAdminApi.removeLegacy).not.toHaveBeenCalled();

  vi.mocked(workshopAdminApi.listLegacy).mockResolvedValue(ITEMS.slice(1));
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(workshopAdminApi.removeLegacy).toHaveBeenCalledWith('a-1'));
  expect(workshopAdminApi.removeLegacy).toHaveBeenCalledTimes(1);
  // it is the activity that is deleted: the file-based deletion is not involved
  expect(workshopAdminApi.remove).not.toHaveBeenCalled();
  expect(await s.findByText('Taller «Taller Académico A» eliminado.')).toBeInTheDocument();
  await waitFor(() => expect(s.queryByRole('heading', { level: 3, name: 'Taller Académico A' })).not.toBeInTheDocument());
  // the others are untouched
  expect(s.getByRole('heading', { level: 3, name: 'Taller de Liderazgo' })).toBeInTheDocument();
  expect(s.getByRole('heading', { level: 3, name: 'CERT DEMO Vida' })).toBeInTheDocument();
});

test('a failed deletion keeps the workshop listed and explains the error', async () => {
  vi.mocked(workshopAdminApi.removeLegacy).mockRejectedValue(new Error('NOT_AUTHORIZED'));
  show();
  const s = await section();
  fireEvent.click(s.getByRole('button', { name: 'Eliminar taller Taller de Liderazgo' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
  expect(await dialog.findByRole('alert')).toBeInTheDocument();
  expect(s.getByRole('heading', { level: 3, name: 'Taller de Liderazgo' })).toBeInTheDocument();
  expect(s.queryByText(/eliminado\./)).not.toBeInTheDocument();
});

test('the type filter of the inbox also narrows this list', async () => {
  show();
  const s = await section();
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'vida_universitaria' } });
  await waitFor(() => expect(s.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['CERT DEMO Vida']));
});

test('without legacy workshops, or when the list cannot be loaded, the inbox simply shows no such section', async () => {
  vi.mocked(workshopAdminApi.listLegacy).mockResolvedValue([]);
  const { unmount } = show();
  await screen.findByText('No hay talleres pendientes.');
  expect(screen.queryByRole('region', { name: 'Talleres sin expediente' })).not.toBeInTheDocument();
  unmount();

  vi.mocked(workshopAdminApi.listLegacy).mockRejectedValue(new Error('INVALID_ACTION'));
  show();
  await screen.findByText('No hay talleres pendientes.');
  expect(screen.queryByRole('region', { name: 'Talleres sin expediente' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
