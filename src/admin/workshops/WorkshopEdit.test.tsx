import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchWorkshopIntakeCatalog } from '../../lib/workshopIntakeApi';
import { workshopAdminApi } from '../../lib/workshopAdminApi';
import WorkshopEdit from './WorkshopEdit';
import { academic, ID } from './fixtures';

vi.mock('../../lib/workshopAdminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/workshopAdminApi')>(),
  workshopAdminApi: { get: vi.fn(), edit: vi.fn() } }));
vi.mock('../../lib/workshopIntakeApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/workshopIntakeApi')>(), fetchWorkshopIntakeCatalog: vi.fn() }));
const show = () => render(<MemoryRouter initialEntries={[`/coordinacion/talleres/${ID}/editar`]}><Routes>
  <Route path="/coordinacion/talleres/:id/editar" element={<WorkshopEdit />} />
  <Route path="/coordinacion/talleres/:id" element={<div>Detalle del taller</div>} />
</Routes></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchWorkshopIntakeCatalog).mockResolvedValue({ edition: null,
    divisions: [{ division_id: 'a', division_name: 'Ciencias de la Salud' }, { division_id: 'b', division_name: 'Ciencias Sociales' }],
    careers: [{ career_id: academic().careers[0].career_id, career_name: 'Medicina', division_id: 'a' },
      { career_id: academic().careers[1].career_id, career_name: 'Derecho', division_id: 'b' }],
    activity_types: [] as never, limits: {} as never });
});

test('loads Forms fields, edits content and persists the selected careers in one request', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), student_pitch: 'Una experiencia médica para conocer la profesión.',
    objective: 'Conocer el trabajo médico en un hospital.', takeaway: 'Conocer la medicina y sus retos.' });
  vi.mocked(workshopAdminApi.edit).mockResolvedValue({ id: ID, status: 'submitted' });
  show();
  expect(await screen.findByDisplayValue('Ana Ruiz')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Una experiencia médica para conocer la profesión.')).toBeInTheDocument();
  expect(screen.getByText('2 carreras seleccionadas')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Nombre completo/), { target: { value: 'Ana Rodríguez' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quitar carrera: Derecho' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(workshopAdminApi.edit).toHaveBeenCalledWith(ID, expect.objectContaining({
    facilitator_name: 'Ana Rodríguez', career_ids: [academic().careers[0].career_id],
  })));
  expect(await screen.findByText('Detalle del taller')).toBeInTheDocument();
});

test('published proposals cannot be edited', async () => {
  vi.mocked(workshopAdminApi.get).mockResolvedValue({ ...academic(), status: 'published' });
  show();
  expect(await screen.findByText(/ya no está pendiente/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
});
