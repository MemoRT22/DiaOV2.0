import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi } from '../../lib/workshopAdminApi';
import WorkshopDetail from './WorkshopDetail';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { get: vi.fn(), approve: vi.fn(), discard: vi.fn() },
}));

import { academic, ID } from './fixtures';
const show = () => render(<MemoryRouter initialEntries={[`/coordinacion/talleres/${ID}`]}><Routes>
  <Route path="/coordinacion/talleres/:id" element={<WorkshopDetail />} />
  <Route path="/coordinacion/talleres/:id/editar" element={<div>Edición abierta</div>} />
</Routes></MemoryRouter>);
beforeEach(() => vi.clearAllMocks());

test.each(['submitted', 'in_review', 'changes_requested', 'approved'] as const)('pending %s offers only Editar, Aprobar, Descartar', async (status) => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status });
  show();
  expect(await screen.findByRole('heading', { name: 'Taller de medicina' })).toBeInTheDocument();
  expect(screen.getByText('Pendiente')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Editar' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
  expect(screen.queryByText(/Revisión administrativa|Publicar en Día OV|Solicitar cambios|Feedback/)).not.toBeInTheDocument();
});

test('one approval request ends published and repeated click makes no second request', async () => {
  let current = academic();
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  let finish!: (result: Awaited<ReturnType<typeof workshopAdminApi.approve>>) => void;
  vi.mocked(workshopAdminApi.approve).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  show();
  const approve = await screen.findByRole('button', { name: 'Aprobar' });
  fireEvent.click(approve); fireEvent.click(approve);
  expect(workshopAdminApi.approve).toHaveBeenCalledTimes(1);
  current = { ...current, status: 'published', published_activity_id: 'activity-1', sessions: [
    { id: 'session-1', starts_at: '2026-10-20T15:00:00Z', ends_at: '2026-10-20T15:30:00Z', capacity: 20, reserved: 7, location: 'Edificio A Salón 1', status: 'activa' },
  ] };
  finish({ submission_id: ID, status: 'published', activity_id: 'activity-1', session_count: 1, career_count: 2, division_count: 2, credential_created: true });
  expect(await screen.findByText('Taller aprobado y publicado.')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Operación del taller' })).toBeInTheDocument();
  expect(screen.getByText(/Reservados 7/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
});

test('discard confirms, creates no activity through the frontend and remains visible as discarded', async () => {
  let current = academic();
  vi.mocked(workshopAdminApi.get).mockImplementation(async () => current);
  vi.mocked(workshopAdminApi.discard).mockImplementation(async () => { current = { ...current, status: 'archived' }; return { id: ID, status: 'archived' }; });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
  expect(screen.getByRole('dialog', { name: 'Descartar taller' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar descarte' }));
  await waitFor(() => expect(workshopAdminApi.discard).toHaveBeenCalledWith(ID));
  expect(await screen.findByText('Taller descartado.')).toBeInTheDocument();
  expect(screen.getByText('Descartado')).toBeInTheDocument();
  expect(workshopAdminApi.approve).not.toHaveBeenCalled();
});

test('published workshop stays in its editorial detail with operational sessions', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status: 'published', published_activity_id: 'activity-1',
    sessions: [{ id: 'session-1', starts_at: '2026-10-20T15:00:00Z', ends_at: '2026-10-20T15:30:00Z', capacity: 20, reserved: 4, location: 'Edificio A', status: 'activa' }] });
  show();
  expect(await screen.findByRole('heading', { name: 'Taller de medicina' })).toBeInTheDocument();
  expect(screen.getByText('Publicado')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', `/coordinacion/talleres/${ID}/editar`);
  expect(screen.getByText(/Cupo 20 · Reservados 4/)).toBeInTheDocument();
  expect(screen.getByText('Medicina')).toBeInTheDocument();
});

const published = (status: string) => ({
  ...academic(), status: 'published' as const, published_activity_id: 'activity-1', sessions: [
    { id: 'session-1', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T16:00:00Z', capacity: 20, reserved: 3, location: 'Salón 1', status },
  ],
});

test('the operational block shows event time (America/Cancun), not the browser time', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published('activa'));
  show();
  expect(await screen.findByRole('heading', { name: 'Operación del taller' })).toBeInTheDocument();
  // 15:00 UTC is 10:00 in Cancún whatever the device time zone is
  expect(screen.getByText(/10:00.*–.*11:00/)).toBeInTheDocument();
});

test('the operational block speaks product language and translates the session status', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published('activa'));
  show();
  await screen.findByRole('heading', { name: 'Operación del taller' });
  expect(screen.getByText('Horarios y cupos del taller.')).toBeInTheDocument();
  expect(screen.queryByText(/actividad vinculada/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Disponible/)).toBeInTheDocument();
  expect(screen.queryByText(/\bactiva\b/)).not.toBeInTheDocument();
});

test.each([['oculta', 'Oculto'], ['cancelada', 'Cancelado'], ['rara', 'Sin estado']])('session status %s is shown as «%s»', async (status, label) => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue(published(status));
  show();
  await screen.findByRole('heading', { name: 'Operación del taller' });
  expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
});
