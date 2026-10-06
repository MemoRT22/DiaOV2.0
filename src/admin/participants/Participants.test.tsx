import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { useAuth, type StaffRole } from '../../lib/auth';
import Participants from './Participants';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', () => ({ fetchCareers: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/auth')>(), useAuth: vi.fn() }));

const hit = (over: Record<string, unknown>) => ({
  id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', phone: null, high_school: null, career_name: null,
  origin: 'forms', is_demo: false, has_birth_date: true, has_logged_in: false, access_locked: false, pending_conflicts: 0, ...over,
});

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ staff: { user_id: 's', full_name: 'Persona', roles } } as unknown as ReturnType<typeof useAuth>);
}
const show = () => render(<MemoryRouter initialEntries={['/coordinacion/participantes']}><Routes>
  <Route path="/coordinacion/participantes" element={<Participants />} />
  <Route path="/coordinacion/participantes/:id" element={<div>Expediente abierto</div>} />
</Routes></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  role(['coordinacion']);
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [hit({})] : undefined) as never);
});

test('Participantes is the single place for search, creation, import and export', async () => {
  show();
  expect(screen.getByRole('link', { name: /Importar padrón/ })).toHaveAttribute('href', '/coordinacion/participantes/importar');
  expect(screen.getByRole('link', { name: /Exportar/ })).toHaveAttribute('href', '/coordinacion/participantes/exportar');
  expect(await screen.findByRole('button', { name: /Dar de alta/ })).toBeEnabled();
});

test('staff can search and create but does not get coordination-only import/export', async () => {
  role(['staff']);
  show();
  expect(screen.queryByRole('link', { name: /Importar padrón/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Exportar/ })).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /Dar de alta/ })).toBeInTheDocument();
});

test('the search result diagnoses access problems without leaving the page', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [
    hit({ id: 'p-1', full_name: 'Ana López', has_birth_date: false }),
    hit({ id: 'p-2', full_name: 'Beto Ruiz', email: 'beto@correo.com', access_locked: true, has_logged_in: true }),
    hit({ id: 'p-3', full_name: 'Carla Díaz', email: 'carla@correo.com', pending_conflicts: 2 }),
  ] : undefined) as never);
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'correo');
  const rows = await screen.findAllByRole('row');
  const [, ana, beto, carla] = rows;
  expect(within(ana).getByText('Sin fecha')).toBeInTheDocument();
  expect(within(beto).getByText('Bloqueado')).toBeInTheDocument();
  expect(within(beto).getByText('Ya entró')).toBeInTheDocument();
  expect(within(carla).getByText('Por revisar')).toBeInTheDocument();
  expect(within(ana).queryByRole('button', { name: /Retirar bloqueo/ })).not.toBeInTheDocument();
});

test('a locked participant can be unblocked straight from the search and the list refreshes', async () => {
  let locked = true;
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'search_participants') return [hit({ id: 'p-2', access_locked: locked })] as never;
    if (name === 'clear_access_lock') { locked = false; return undefined as never; }
    return undefined as never;
  });
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'ana');
  fireEvent.click(await screen.findByRole('button', { name: /Retirar bloqueo/ }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('clear_access_lock', { p_id: 'p-2' }));
  await waitFor(() => expect(screen.queryByText('Bloqueado')).not.toBeInTheDocument());
  expect(screen.queryByText('Expediente abierto')).not.toBeInTheDocument();
});

test('no match explains the likely cause of "no puede entrar" and offers the signup', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [] : undefined) as never);
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'nadie@correo.com');
  expect(await screen.findByText(/se registró con otro correo/)).toBeInTheDocument();
  expect(screen.getByText('nadie@correo.com')).toBeInTheDocument();
});

test('the retired access-diagnosis RPC is no longer used by the participants flow', async () => {
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'ana');
  await screen.findByText('Ana López');
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).not.toContain('access_diagnosis');
});
