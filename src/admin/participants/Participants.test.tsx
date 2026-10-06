import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { useAuth, type StaffRole } from '../../lib/auth';
import Participants from './Participants';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/auth')>(), useAuth: vi.fn() }));

const hit = (over: Record<string, unknown>) => ({
  id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', phone: null, high_school: null, career_name: null,
  origin: 'forms', is_demo: false, has_logged_in: false, access_configured: true, pending_conflicts: 0, ...over,
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

test('Participantes is the single place for search, import and export: nobody is registered by hand any more', async () => {
  show();
  expect(screen.getByRole('link', { name: /Importar padrón/ })).toHaveAttribute('href', '/coordinacion/participantes/importar');
  expect(screen.getByRole('link', { name: /Exportar/ })).toHaveAttribute('href', '/coordinacion/participantes/exportar');
  expect(screen.queryByRole('button', { name: /Dar de alta/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/dar de alta|dalo de alta|alta presencial/i)).not.toBeInTheDocument();
});

test('staff can search but does not get coordination-only import/export, and there is no creation button either', async () => {
  role(['staff']);
  show();
  expect(screen.queryByRole('link', { name: /Importar padrón/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Exportar/ })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Buscar participante' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Dar de alta/ })).not.toBeInTheDocument();
});

test('the result shows account state and review needs, with no birth-date or lock badges', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [
    hit({ id: 'p-1', full_name: 'Ana López', access_configured: false }),
    hit({ id: 'p-2', full_name: 'Beto Ruiz', email: 'beto@correo.com', has_logged_in: true, origin: 'self_service' }),
    hit({ id: 'p-3', full_name: 'Carla Díaz', email: 'carla@correo.com', pending_conflicts: 2 }),
  ] : undefined) as never);
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'correo');
  const rows = await screen.findAllByRole('row');
  const [, ana, beto, carla] = rows;
  expect(within(ana).getByText('Acceso no configurado')).toBeInTheDocument();
  expect(within(beto).getByText('Autorregistro')).toBeInTheDocument();
  expect(within(beto).getByText('Ya entró')).toBeInTheDocument();
  expect(within(carla).getByText('Por revisar')).toBeInTheDocument();
  expect(within(carla).queryByText('Acceso no configurado')).not.toBeInTheDocument();
  expect(screen.queryByText(/Sin fecha|Bloqueado|Retirar bloqueo/)).not.toBeInTheDocument();
});

test('a legacy server that still returns birth-date and lock fields does not change what is shown', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants'
    ? [hit({ has_birth_date: false, access_locked: true })] : undefined) as never);
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'ana');
  await screen.findByText('Ana López');
  expect(screen.queryByText(/Sin fecha|Bloqueado|Retirar bloqueo/)).not.toBeInTheDocument();
});

test('no match explains the likely cause of "no puede entrar" and points to self-registration, not to manual signup', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [] : undefined) as never);
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'nadie@correo.com');
  expect(await screen.findByText(/se registró con otro correo/)).toBeInTheDocument();
  expect(screen.getByText(/puede registrarse desde la pantalla de acceso/)).toBeInTheDocument();
  expect(screen.getByText('nadie@correo.com')).toBeInTheDocument();
  expect(screen.queryByText(/dalo de alta/i)).not.toBeInTheDocument();
});

test('the participants flow never calls the retired lock or manual-signup RPCs', async () => {
  show();
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar participante' }), 'ana');
  await screen.findByText('Ana López');
  const called = vi.mocked(rpc).mock.calls.map(([name]) => name);
  expect(called).toEqual(['search_participants']);
  expect(called).not.toContain('clear_access_lock');
  expect(called).not.toContain('create_participant_manual');
  expect(called).not.toContain('access_diagnosis');
});
