import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi, type WorkshopDetail as Detail } from '../../lib/workshopAdminApi';
import WorkshopDetail from './WorkshopDetail';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { list: vi.fn(), get: vi.fn(), transition: vi.fn(), publish: vi.fn() },
}));

const ID = '11111111-1111-4111-8111-111111111111';
const academic = (): Detail => ({
  id: ID, status: 'submitted', created_at: '2026-10-05T15:00:00Z', updated_at: '2026-10-05T15:00:00Z',
  submitted_at: '2026-10-05T15:00:00Z', reviewed_at: null, reviewed_by: null, reviewer_name: null,
  facilitator_name: 'Ana Ruiz', facilitator_email: 'ana@example.com', activity_type: 'academica',
  experience_category: null, title: 'Taller de medicina', student_pitch: 'Experiencia médica',
  objective: 'Conocer el trabajo médico', 
  takeaway: 'Conocimiento', keywords: ['medicina', 'salud', 'alumnos'], session_duration_minutes: 30,
  capacity_per_session: 20, career_count: 2, operating_start_time: '10:00:00', operating_end_time: '12:00:00',
  building: 'Edificio A', room_space: 'Salón 1', requirements: 'Proyector', notes: 'Traer material',
  admin_notes: null, review_feedback: null, published_activity_id: null, careers: [
    { career_id: '1', career_name: 'Medicina', division_id: 'a', division_name: 'Ciencias de la Salud', division_code: 'DIV-SALUD' },
    { career_id: '2', career_name: 'Derecho', division_id: 'b', division_name: 'Ciencias Sociales y Jurídicas', division_code: 'DIV-SOCIALES-JURIDICAS' },
  ],
});
const show = () => render(<MemoryRouter initialEntries={[`/coordinacion/talleres/${ID}`]}><Routes>
  <Route path="/coordinacion/talleres/:id" element={<WorkshopDetail />} />
</Routes></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

test('renders academic detail, careers by division and complete logistics', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(academic());
  show();
  expect(await screen.findByRole('heading', { level: 1, name: 'Taller de medicina' })).toBeInTheDocument();
  expect(screen.getByText('Ciencias de la Salud')).toBeInTheDocument();
  expect(screen.getByText('Ciencias Sociales y Jurídicas')).toBeInTheDocument();
  expect(screen.getByText('Medicina')).toBeInTheDocument();
  expect(screen.getByText('10:00–12:00')).toBeInTheDocument();
  expect(screen.queryByText('Clasificación')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comenzar revisión' })).toBeInTheDocument();
});

test('Vida Universitaria shows category and no careers', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), activity_type: 'vida_universitaria', experience_category: 'deportiva', careers: [], career_count: 0 });
  show();
  expect(await screen.findByText('Deportiva')).toBeInTheDocument();
  expect(screen.queryByText('Carreras relacionadas')).not.toBeInTheDocument();
  expect(screen.getByText('Experiencia de Vida Universitaria')).toBeInTheDocument();
});

test('starts review, saves notes, requests changes, resumes and confirms archive', async () => {
  let current = academic();
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  vi.mocked(workshopAdminApi.transition).mockImplementation(async (action, _id, fields) => {
    const status = { start_review: 'in_review', save_notes: current.status, request_changes: 'changes_requested',
      resume_review: 'in_review', approve: 'approved', archive: 'archived' }[action] as Detail['status'];
    current = { ...current, status, admin_notes: fields?.admin_notes ?? current.admin_notes,
      review_feedback: fields?.review_feedback ?? current.review_feedback, reviewed_at: '2026-10-05T16:00:00Z', reviewer_name: 'Coord' };
    return { id: ID, status };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Comenzar revisión' }));
  expect(await screen.findByRole('button', { name: 'Solicitar cambios' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Notas internas de Coordinación'), { target: { value: 'Revisar cupo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar notas internas' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('save_notes', ID, { admin_notes: 'Revisar cupo' }));
  fireEvent.change(screen.getByLabelText('Feedback para el tallerista'), { target: { value: 'Especifica materiales' } });
  fireEvent.click(screen.getByRole('button', { name: 'Solicitar cambios' }));
  expect(await screen.findByRole('button', { name: 'Reanudar revisión' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copiar feedback' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reanudar revisión' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('resume_review', ID, {}));
  fireEvent.click(screen.getByRole('button', { name: 'Archivar propuesta' }));
  expect(screen.getByRole('dialog', { name: 'Archivar propuesta' })).toBeInTheDocument();
  expect(workshopAdminApi.transition).not.toHaveBeenCalledWith('archive', ID, expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar archivo' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('archive', ID, { admin_notes: 'Revisar cupo' }));
  expect(await screen.findByText('Propuesta archivada.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Comenzar revisión' })).not.toBeInTheDocument();
});

test('shows load error', async () => {
  vi.mocked(workshopAdminApi.get).mockRejectedValueOnce(new Error('NETWORK'));
  show();
  expect(await screen.findByText(/No hay conexión/)).toBeInTheDocument();
});

test('approves a proposal in review and refreshes the approved detail', async () => {
  let current = { ...academic(), status: 'in_review' as Detail['status'] };
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  vi.mocked(workshopAdminApi.transition).mockImplementation(async () => {
    current = { ...current, status: 'approved' };
    return { id: ID, status: 'approved' };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar propuesta' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('approve', ID, {}));
  expect(await screen.findByRole('button', { name: 'Publicar en Día OV' })).toBeInTheDocument();
  expect(screen.getByText('Propuesta aprobada.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Solicitar cambios' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Guardar notas internas' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Archivar propuesta' })).toBeInTheDocument();
});

test('opens and cancels the publication summary without publishing', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status: 'approved' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Publicar en Día OV' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirmar publicación' });
  expect(dialog).toHaveTextContent('Taller académico');
  expect(dialog).toHaveTextContent('Taller de medicina');
  expect(dialog).toHaveTextContent('4');
  expect(dialog).toHaveTextContent('20');
  expect(dialog).toHaveTextContent('10:00–12:00');
  expect(dialog).toHaveTextContent('Edificio A · Salón 1');
  expect(dialog).toHaveTextContent('Ciencias de la Salud');
  expect(dialog).toHaveTextContent('Derecho');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog', { name: 'Confirmar publicación' })).not.toBeInTheDocument();
  expect(workshopAdminApi.publish).not.toHaveBeenCalled();
});

test('shows Vida Universitaria category and no careers in publication summary', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status: 'approved',
    activity_type: 'vida_universitaria', experience_category: 'deportiva', careers: [], career_count: 0,
    session_duration_minutes: 60, operating_end_time: '11:30:00' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Publicar en Día OV' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirmar publicación' });
  expect(dialog).toHaveTextContent('Vida Universitaria');
  expect(dialog).toHaveTextContent('Deportiva');
  expect(dialog).toHaveTextContent('Sesiones previstas');
  expect(dialog).toHaveTextContent('2');
  expect(dialog).toHaveTextContent('Fin de la última sesión');
  expect(dialog).toHaveTextContent('12:00');
  expect(dialog).not.toHaveTextContent('Carreras y divisiones');
});

test('keeps notes and archive available on approved proposals', async () => {
  let current = { ...academic(), status: 'approved' as Detail['status'] };
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  vi.mocked(workshopAdminApi.transition).mockImplementation(async (action, _id, fields) => {
    current = { ...current, status: action === 'archive' ? 'archived' : 'approved',
      admin_notes: fields?.admin_notes ?? current.admin_notes };
    return { id: ID, status: current.status };
  });
  show();
  await screen.findByRole('button', { name: 'Publicar en Día OV' });
  fireEvent.change(screen.getByLabelText('Notas internas de Coordinación'), { target: { value: 'Revisar ubicación' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar notas internas' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('save_notes', ID, { admin_notes: 'Revisar ubicación' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archivar propuesta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar archivo' }));
  await waitFor(() => expect(workshopAdminApi.transition).toHaveBeenCalledWith('archive', ID, { admin_notes: 'Revisar ubicación' }));
  expect(await screen.findByText('Propuesta archivada.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publicar en Día OV' })).not.toBeInTheDocument();
});

test('publishes once, shows the operational result and stays read-only after refresh', async () => {
  let current = { ...academic(), status: 'approved' as Detail['status'] };
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  let finish!: (result: Awaited<ReturnType<typeof workshopAdminApi.publish>>) => void;
  vi.mocked(workshopAdminApi.publish).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const view = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Publicar en Día OV' }));
  const confirm = screen.getByRole('button', { name: 'Confirmar publicación' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(workshopAdminApi.publish).toHaveBeenCalledTimes(1);
  expect(workshopAdminApi.publish).toHaveBeenCalledWith(ID);
  expect(confirm).toBeDisabled();
  current = { ...current, status: 'published', published_activity_id: 'activity-1' };
  finish({ submission_id: ID, status: 'published', activity_id: 'activity-1', session_count: 4,
    career_count: 2, division_count: 2, credential_created: true });
  expect(await screen.findByText('Propuesta publicada en Día OV.')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Actividad publicada' })).toBeInTheDocument();
  expect(screen.getByText('activity-1')).toBeInTheDocument();
  expect(screen.getByText('Generada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publicar en Día OV' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar notas internas' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archivar propuesta' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Notas internas de Coordinación')).toHaveAttribute('readonly');
  view.unmount();
  show();
  expect(await screen.findByRole('heading', { name: 'Actividad publicada' })).toBeInTheDocument();
  expect(screen.getByText('activity-1')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publicar en Día OV' })).not.toBeInTheDocument();
});

test.each([
  ['approve', 'in_review', 'Aprobar propuesta', 'INVALID_TRANSITION'],
  ['publish', 'approved', 'Confirmar publicación', 'PUBLISH_STATE_INCONSISTENT'],
] as const)('shows %s errors and keeps the action available', async (action, status, button, code) => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status });
  vi.mocked(workshopAdminApi.transition).mockRejectedValue(new Error(code));
  vi.mocked(workshopAdminApi.publish).mockRejectedValue(new Error(code));
  show();
  if (action === 'publish') fireEvent.click(await screen.findByRole('button', { name: 'Publicar en Día OV' }));
  fireEvent.click(await screen.findByRole('button', { name: button }));
  expect(await screen.findByRole('alert')).toHaveTextContent(action === 'approve'
    ? 'El estado de la propuesta cambió' : 'La propuesta y la actividad publicada no coinciden');
  expect(screen.getByRole('button', { name: button })).toBeEnabled();
  if (action === 'publish') expect(screen.getByRole('dialog', { name: 'Confirmar publicación' })).toBeInTheDocument();
});

test.each([
  ['submitted', ['Comenzar revisión', 'Archivar propuesta']],
  ['in_review', ['Solicitar cambios', 'Aprobar propuesta', 'Archivar propuesta']],
  ['changes_requested', ['Reanudar revisión', 'Archivar propuesta']],
  ['approved', ['Publicar en Día OV', 'Archivar propuesta']],
  ['published', []],
  ['archived', []],
] as const)('offers only valid review actions for %s', async (status, expected) => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status });
  show();
  await screen.findByRole('heading', { level: 1, name: 'Taller de medicina' });
  const actions = ['Comenzar revisión', 'Solicitar cambios', 'Aprobar propuesta',
    'Reanudar revisión', 'Publicar en Día OV', 'Archivar propuesta'];
  for (const action of actions) {
    if (expected.some((label) => label === action)) expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: action })).not.toBeInTheDocument();
  }
});
