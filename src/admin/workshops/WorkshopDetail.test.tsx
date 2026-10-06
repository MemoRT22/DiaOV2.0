import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi, type WorkshopDetail as Detail } from '../../lib/workshopAdminApi';
import WorkshopDetail from './WorkshopDetail';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { list: vi.fn(), get: vi.fn(), transition: vi.fn() },
}));

const ID = '11111111-1111-4111-8111-111111111111';
const academic = (): Detail => ({
  id: ID, status: 'submitted', created_at: '2026-10-05T15:00:00Z', updated_at: '2026-10-05T15:00:00Z',
  submitted_at: '2026-10-05T15:00:00Z', reviewed_at: null, reviewed_by: null, reviewer_name: null,
  facilitator_name: 'Ana Ruiz', facilitator_email: 'ana@example.com', activity_type: 'academica',
  experience_category: null, title: 'Taller de medicina', student_pitch: 'Experiencia médica',
  why_join: 'Aprender medicina', objective: 'Conocer el trabajo médico', student_experience: 'Simulación',
  takeaway: 'Conocimiento', keywords: ['medicina', 'salud', 'alumnos'], session_duration_minutes: 30,
  capacity_per_session: 20, career_count: 2, operating_start_time: '10:00:00', operating_end_time: '12:00:00',
  building: 'Edificio A', room_space: 'Salón 1', requirements: 'Proyector', notes: 'Traer material',
  admin_notes: null, review_feedback: null, careers: [
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
      resume_review: 'in_review', archive: 'archived' }[action] as Detail['status'];
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
