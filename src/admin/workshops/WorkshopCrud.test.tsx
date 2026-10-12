import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchWorkshopIntakeCatalog } from '../../lib/workshopIntakeApi';
import { workshopAdminApi } from '../../lib/workshopAdminApi';
import WorkshopDetail from './WorkshopDetail';
import { formFromDetail, WorkshopCreate } from './WorkshopEdit';
import WorkshopInbox from './WorkshopInbox';
import { academic, ID } from './fixtures';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { get: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn(), approve: vi.fn(), discard: vi.fn(), edit: vi.fn() },
}));
vi.mock('../../lib/workshopIntakeApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/workshopIntakeApi')>(), fetchWorkshopIntakeCatalog: vi.fn() }));
// The creation form starts empty; a filled draft stands in for the typing so the tests focus on what gets sent.
const draft = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../lib/workshopForm', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/workshopForm')>();
  return { ...original, emptyForm: () => (draft.value as ReturnType<typeof original.emptyForm> | null) ?? original.emptyForm() };
});

const valid = () => ({ ...academic(), student_pitch: 'Una experiencia médica para conocer la profesión.',
  objective: 'Conocer el trabajo médico en un hospital.', takeaway: 'Conocer la medicina y sus retos.' });
const published = (dependents: { sessions: number; reservations: number; attendances: number; participants: number }) => ({
  ...valid(), status: 'published' as const, published_activity_id: 'activity-1', dependents,
  sessions: [{ id: 's1', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z', capacity: 20, reserved: 2, location: 'Edificio A Salón 1', status: 'activa' }],
});

function Listing() {
  const state = useLocation().state as { notice?: string } | null;
  return <div>Lista de talleres{state?.notice ? ` · ${state.notice}` : ''}</div>;
}
const showDetail = () => render(<MemoryRouter initialEntries={[`/coordinacion/talleres/${ID}`]}><Routes>
  <Route path="/coordinacion/talleres" element={<Listing />} />
  <Route path="/coordinacion/talleres/:id" element={<WorkshopDetail />} />
</Routes></MemoryRouter>);
const showCreate = () => render(<MemoryRouter initialEntries={['/coordinacion/talleres/nuevo']}><Routes>
  <Route path="/coordinacion/talleres" element={<Listing />} />
  <Route path="/coordinacion/talleres/nuevo" element={<WorkshopCreate />} />
  <Route path="/coordinacion/talleres/:id" element={<div>Detalle del taller creado</div>} />
</Routes></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  draft.value = null;
  vi.mocked(fetchWorkshopIntakeCatalog).mockResolvedValue({ edition: null,
    divisions: [{ division_id: 'a', division_name: 'Ciencias de la Salud' }, { division_id: 'b', division_name: 'Ciencias Sociales' }],
    careers: [{ career_id: academic().careers[0].career_id, career_name: 'Medicina', division_id: 'a' },
      { career_id: academic().careers[1].career_id, career_name: 'Derecho', division_id: 'b' }],
    activity_types: [] as never, limits: {} as never });
});

// ------------------------------------------------------------------------------------------------------ delete

test.each([
  ['submitted', 'Pendiente'], ['published', 'Publicado'], ['archived', 'Descartado'],
] as const)('a %s workshop can be deleted from its file', async (status, badge) => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(status === 'published'
    ? published({ sessions: 1, reservations: 0, attendances: 0, participants: 0 }) : { ...valid(), status });
  showDetail();
  expect(await screen.findByText(badge)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Eliminar taller' })).toBeInTheDocument();
});

test('deleting a published workshop spells out the related data and needs a typed confirmation', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published({ sessions: 4, reservations: 7, attendances: 3, participants: 6 }));
  vi.mocked(workshopAdminApi.remove).mockResolvedValue({ submission_id: ID, deleted: true, removed: { sessions: 4, reservations: 7, attendances: 3, participants: 6 } });
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar taller' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Esta acción no se puede deshacer/)).toBeInTheDocument();
  expect(dialog.getByText(/Dejará de aparecer para los alumnos de inmediato/)).toBeInTheDocument();
  const related = within(dialog.getByRole('list', { name: 'Datos que se eliminarán' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(related).toEqual([
    '4 horarios y su código QR de asistencia', '7 reservaciones', '3 asistencias registradas, con los sellos que otorgaron',
  ]);
  expect(dialog.getByText('6 alumnos perderán su reservación o sus sellos de este taller.')).toBeInTheDocument();

  // nothing happens until the phrase is typed exactly
  const confirm = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  expect(confirm).toBeDisabled();
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'eliminar' } });
  expect(confirm).toBeDisabled();
  expect(workshopAdminApi.remove).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(confirm);

  await waitFor(() => expect(workshopAdminApi.remove).toHaveBeenCalledWith(ID));
  expect(workshopAdminApi.remove).toHaveBeenCalledTimes(1);
  // back in the list, with the result confirmed; the workshop file is gone
  expect(await screen.findByText('Lista de talleres · Taller «Taller de medicina» eliminado.')).toBeInTheDocument();
});

test('singular wording and no warning when nobody is affected', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published({ sessions: 1, reservations: 1, attendances: 0, participants: 1 }));
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar taller' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('1 horario y su código QR de asistencia')).toBeInTheDocument();
  expect(dialog.getByText('1 reservación')).toBeInTheDocument();
  expect(dialog.getByText('0 asistencias registradas, con los sellos que otorgaron')).toBeInTheDocument();
  expect(dialog.getByText('1 alumno perderá su reservación o sus sellos de este taller.')).toBeInTheDocument();
});

test('a workshop that is not published says it has nothing related', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...valid(), status: 'archived' });
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar taller' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText('El taller no está publicado: no tiene horarios, reservaciones ni asistencias.')).toBeInTheDocument();
  expect(dialog.queryByRole('list')).not.toBeInTheDocument();
});

test('cancelling or a server error deletes nothing and keeps the workshop on screen', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published({ sessions: 2, reservations: 0, attendances: 0, participants: 0 }));
  vi.mocked(workshopAdminApi.remove).mockRejectedValue(new Error('NOT_AUTHORIZED'));
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar taller' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(workshopAdminApi.remove).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Eliminar taller' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
  expect(await dialog.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Taller de medicina' })).toBeInTheDocument();
  expect(screen.queryByText(/Lista de talleres/)).not.toBeInTheDocument();
});

// ------------------------------------------------------------------------------------------------------ create

test('the list offers «Nuevo taller» and confirms a deletion that just happened', async () => {
  vi.mocked(workshopAdminApi.list).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20, counts: { pending: 0, published: 0, archived: 0 } });
  render(<MemoryRouter initialEntries={[{ pathname: '/coordinacion/talleres', state: { notice: 'Taller «Taller de medicina» eliminado.' } }]}>
    <Routes><Route path="/coordinacion/talleres" element={<WorkshopInbox />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Nuevo taller' })).toHaveAttribute('href', '/coordinacion/talleres/nuevo');
  expect(screen.getByText('Taller «Taller de medicina» eliminado.')).toBeInTheDocument();
});

test('a new workshop starts empty and is validated before anything is sent', async () => {
  showCreate();
  expect(await screen.findByRole('heading', { name: 'Nuevo taller' })).toBeInTheDocument();
  expect(screen.getByLabelText(/Nombre completo/)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Crear y publicar' }));
  expect(await screen.findByText('Revisa los campos marcados antes de guardar.')).toBeInTheDocument();
  expect(workshopAdminApi.create).not.toHaveBeenCalled();
});

test('«Guardar como pendiente» creates the workshop through the unified model without publishing', async () => {
  draft.value = formFromDetail(valid());
  vi.mocked(workshopAdminApi.create).mockResolvedValue({ submission_id: 'new-1', status: 'submitted', activity_id: null });
  showCreate();
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar como pendiente' }));
  await waitFor(() => expect(workshopAdminApi.create).toHaveBeenCalledTimes(1));
  expect(workshopAdminApi.create).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Taller de medicina', activity_type: 'academica', session_duration_minutes: 30,
    career_ids: academic().careers.map((c) => c.career_id),
  }), false);
  expect(await screen.findByText('Detalle del taller creado')).toBeInTheDocument();
});

test('«Crear y publicar» publishes in the same operation; a Vida Universitaria workshop needs no careers', async () => {
  draft.value = { ...formFromDetail(valid()), activity_type: 'vida_universitaria', experience_category: 'deportiva', career_ids: [], title: 'Torneo relámpago' };
  vi.mocked(workshopAdminApi.create).mockResolvedValue({ submission_id: 'new-2', status: 'published', activity_id: 'activity-9' });
  showCreate();
  await screen.findByRole('heading', { name: 'Nuevo taller' });
  expect(screen.queryByText('Carreras relacionadas')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Crear y publicar' }));
  await waitFor(() => expect(workshopAdminApi.create).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Torneo relámpago', activity_type: 'vida_universitaria', experience_category: 'deportiva', career_ids: [],
  }), true));
  expect(await screen.findByText('Detalle del taller creado')).toBeInTheDocument();
});

test('a server rejection is explained and the form stays filled for another try', async () => {
  draft.value = formFromDetail(valid());
  vi.mocked(workshopAdminApi.create).mockRejectedValue(new Error('INVALID_CAREER'));
  showCreate();
  fireEvent.click(await screen.findByRole('button', { name: 'Crear y publicar' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Taller de medicina')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Crear y publicar' })).toBeEnabled();
  expect(screen.queryByText('Detalle del taller creado')).not.toBeInTheDocument();
});
