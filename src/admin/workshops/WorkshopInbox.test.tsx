import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { workshopAdminApi, type WorkshopList, type WorkshopSummary, type WorkshopGroup } from '../../lib/workshopAdminApi';
import WorkshopInbox from './WorkshopInbox';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { list: vi.fn() },
}));
const academic: WorkshopSummary = {
  id: '11111111-1111-4111-8111-111111111111', status: 'submitted', submitted_at: '2026-10-05T15:00:00Z',
  title: 'Exploración de medicina', activity_type: 'academica', experience_category: null,
  facilitator_name: 'Ana Ruiz', session_duration_minutes: 30, capacity_per_session: 20,
  career_count: 2, career_names: ['Medicina', 'Enfermería'], building: 'Edificio A', room_space: 'Salón 1',
};
const list = (items: WorkshopSummary[], counts: WorkshopList['counts'] = { pending: 1, published: 1, archived: 1 }): WorkshopList =>
  ({ items, total: items.length, page: 1, page_size: 25, counts });
const show = () => render(<MemoryRouter initialEntries={['/coordinacion/talleres']}><Routes>
  <Route path="/coordinacion/talleres" element={<WorkshopInbox />} />
  <Route path="/coordinacion/talleres/:id" element={<div>Detalle abierto</div>} />
</Routes></MemoryRouter>);
beforeEach(() => vi.clearAllMocks());

test.each([
  ['pending', 'Pendientes', 'submitted'], ['published', 'Publicados', 'published'], ['archived', 'Descartados', 'archived'],
] as const)('%s is a human filter with compact cards', async (group, button, physical) => {
  vi.mocked(workshopAdminApi.list).mockImplementation(async ({ status }) => list(status === group ? [{ ...academic, status: physical }] : []));
  show();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(button) }));
  expect(await screen.findByText('Exploración de medicina')).toBeInTheDocument();
  expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: group as WorkshopGroup }));
  const card = screen.getByRole('link', { name: /Exploración de medicina/ });
  expect(within(card).getByText('Ana Ruiz')).toBeInTheDocument();
  expect(within(card).getByText('Medicina, Enfermería')).toBeInTheDocument();
  expect(within(card).getByText('Edificio A · Salón 1')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Programa' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Propuestas' })).not.toBeInTheDocument();
});

test('searches and paginates without loading the complete Forms payload', async () => {
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list([academic]));
  show();
  await screen.findByText('Exploración de medicina');
  fireEvent.change(screen.getByLabelText('Buscar talleres'), { target: { value: 'ana@' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  await waitFor(() => expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana@' })));
  fireEvent.click(screen.getByRole('link', { name: /Exploración de medicina/ }));
  expect(screen.getByText('Detalle abierto')).toBeInTheDocument();
});

test('a long inbox keeps 25 compact rows per page and moves to the next page', async () => {
  vi.mocked(workshopAdminApi.list).mockImplementation(async ({ page }) => ({
    ...list(Array.from({ length: page === 1 ? 25 : 5 }, (_, index) => ({
      ...academic, id: `${page}-${index}`, title: `Taller ${page}-${index}`,
    }))), total: 30, page: page ?? 1,
  }));
  show();
  expect(await screen.findByText('Taller 1-24')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Taller 1-/ })).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(await screen.findByText('Taller 2-4')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Taller 2-/ })).toHaveLength(5);
  expect(workshopAdminApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, status: 'pending' }));
});
