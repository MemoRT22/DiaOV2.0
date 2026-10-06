import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi, type WorkshopList, type WorkshopSummary } from '../../lib/workshopAdminApi';
import WorkshopInbox from './WorkshopInbox';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { list: vi.fn(), get: vi.fn(), transition: vi.fn() },
}));

const academic: WorkshopSummary = {
  id: '11111111-1111-4111-8111-111111111111', status: 'submitted', submitted_at: '2026-10-05T15:00:00Z',
  title: 'Exploración de medicina', activity_type: 'academica', experience_category: null,
  facilitator_name: 'Ana Ruiz', session_duration_minutes: 30, capacity_per_session: 20, career_count: 2,
};
const life: WorkshopSummary = {
  ...academic, id: '22222222-2222-4222-8222-222222222222', title: 'Deporte universitario',
  activity_type: 'vida_universitaria', experience_category: 'deportiva', career_count: 0,
};
const list = (items: WorkshopSummary[]): WorkshopList => ({ items, total: items.length, page: 1, page_size: 25, counts: { submitted: items.length } });
const show = () => render(<MemoryRouter initialEntries={['/coordinacion/talleres']}><Routes>
  <Route path="/coordinacion/talleres" element={<WorkshopInbox />} />
  <Route path="/coordinacion/talleres/:id" element={<div>Detalle abierto</div>} />
</Routes></MemoryRouter>);

beforeEach(() => vi.clearAllMocks());

test('shows loading and a useful empty state', async () => {
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list([]));
  show();
  expect(screen.getByText('Cargando propuestas')).toBeInTheDocument();
  expect(await screen.findByText('Aún no hay propuestas de talleres.')).toBeInTheDocument();
  expect(screen.getByText(/Cuando los talleristas envíen/)).toBeInTheDocument();
});

test('shows academic and Vida Universitaria cards, filters and opens detail', async () => {
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list([academic, life]));
  show();
  expect(await screen.findByText('Exploración de medicina')).toBeInTheDocument();
  expect(screen.getByText('Deporte universitario')).toBeInTheDocument();
  expect(screen.getByText(/Deportiva/)).toBeInTheDocument();
  expect(within(screen.getByRole('link', { name: /Exploración de medicina/ })).getByText('2')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'submitted' } });
  await waitFor(() => expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'submitted' })));
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'vida_universitaria' } });
  await waitFor(() => expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'vida_universitaria' })));
  fireEvent.change(screen.getByLabelText('Buscar propuestas'), { target: { value: 'ana@' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await waitFor(() => expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana@' })));
  fireEvent.click(screen.getByRole('link', { name: /Exploración de medicina/ }));
  expect(screen.getByText('Detalle abierto')).toBeInTheDocument();
});

test('shows an error with retry', async () => {
  vi.mocked(workshopAdminApi.list).mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce(list([]));
  show();
  expect(await screen.findByText(/No hay conexión/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Aún no hay propuestas de talleres.')).toBeInTheDocument();
});
