import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { fetchCareers, fetchHighSchools } from '../../lib/catalog';
import { useAuth, type StaffRole } from '../../lib/auth';
import Participants from './Participants';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchCareers: vi.fn(), fetchHighSchools: vi.fn() }));
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
  vi.mocked(fetchCareers).mockResolvedValue([]);
  vi.mocked(fetchHighSchools).mockResolvedValue([]);
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [hit({})] : undefined) as never);
});

test('edits participant data directly from the list and refreshes the result', async () => {
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    if (name === 'search_participants') return [hit({})];
    if (name === 'get_participant') return {
      id: 'p-1', email: 'ana@correo.com', full_name: 'Ana López', phone: null, high_school: null,
      high_school_id: null, high_school_grade: null, entry_period: null, initial_career_id: null,
    };
    if (name === 'update_participant') return null;
    return undefined;
  }) as never);
  show();
  await screen.findByText('Ana López');
  await userEvent.click(screen.getByRole('button', { name: 'Editar datos de Ana López' }));
  const dialog = await screen.findByRole('dialog', { name: 'Corregir datos' });
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Nombre completo' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nombre completo' }), 'Ana María López');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));
  expect(vi.mocked(rpc)).toHaveBeenCalledWith('update_participant', { p_id: 'p-1', p: { full_name: 'Ana María López' } });
});

test('Participantes is the single place for search, import and export: nobody is registered by hand any more', async () => {
  show();
  expect(screen.getByRole('link', { name: /Importar participantes/ })).toHaveAttribute('href', '/coordinacion/participantes/importar');
  expect(screen.getByRole('link', { name: /Exportar/ })).toHaveAttribute('href', '/coordinacion/participantes/exportar');
  expect(screen.queryByRole('button', { name: /Dar de alta/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/dar de alta|dalo de alta|alta presencial/i)).not.toBeInTheDocument();
});

test('staff can search but does not get coordination-only import/export, and there is no creation button either', async () => {
  role(['staff']);
  show();
  expect(screen.queryByRole('link', { name: /Importar participantes/ })).not.toBeInTheDocument();
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
  // Solo lectura: la búsqueda y las dos consultas del panel de orientación.
  expect(new Set(called)).toEqual(new Set(['search_participants', 'participants_dashboard_summary', 'participants_orientation']));
  expect(called).not.toContain('clear_access_lock');
  expect(called).not.toContain('create_participant_manual');
  expect(called).not.toContain('access_diagnosis');
});

test('without typing, the most recent registrations are listed (a student who just signed up appears right away)', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants'
    ? [hit({ id: 'p-new', full_name: 'Recién Registrado', origin: 'self_service', email: 'nuevo@correo.com' })] : undefined) as never);
  show();
  expect(await screen.findByText('Recién Registrado')).toBeInTheDocument();
  expect(screen.getByText('Registros más recientes')).toBeInTheDocument();
  expect(vi.mocked(rpc)).toHaveBeenCalledWith('search_participants', { p_query: '' });
  await userEvent.click(screen.getByRole('link', { name: 'Recién Registrado' }));
  expect(await screen.findByText('Expediente abierto')).toBeInTheDocument();
});

test('an empty edition says so instead of a «no match» message', async () => {
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'search_participants' ? [] : undefined) as never);
  show();
  expect(await screen.findByText('Aún no hay participantes registrados en esta edición.')).toBeInTheDocument();
  expect(screen.queryByText(/se registró con otro correo/)).not.toBeInTheDocument();
});

const orient = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', last_seen_at: new Date(Date.now() - 5 * 60_000).toISOString(), reservations_active: 0, attendances: 0, stamps: 0, category: null, others: [], ...over,
});
const summary = { server_time: '2026-10-15T16:00:00Z', accounts_total: 1700, accounts_with_login: 1500, active_last_hour: 420, with_reservations: 1295, reservations_active: 3534,
  with_attendance: 300, stamps_total: 410, duplicate_groups: 129, duplicate_accounts: 268, duplicates_data_split: 57, duplicates_route_elsewhere: 9 };

test('shows the quick dashboard for Coordinación and Staff', async () => {
  vi.mocked(rpc).mockImplementation((async (name: string) => (name === 'search_participants' ? [hit({})] : name === 'participants_dashboard_summary' ? summary : [])) as never);
  role(['staff']);
  show();
  const dash = await screen.findByRole('region', { name: 'Resumen de participantes' });
  expect(within(dash).getByText('1700')).toBeInTheDocument();
  expect(within(dash).getByText('420')).toBeInTheDocument();
  expect(within(dash).getByText('3534 vigentes')).toBeInTheDocument();
  expect(within(dash).getByText('Posibles duplicados')).toBeInTheDocument();
  expect(within(dash).getByText('Su ruta está en otra cuenta')).toBeInTheDocument();
});

test('a search lists each person with their activity and ALL their other accounts, pointing to the one that has their route', async () => {
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    if (name === 'search_participants') return [hit({ id: 'p-1', full_name: 'Karol Orozco', email: 'karolorozcocamacho@gmail.com', phone: '9981487369' })];
    if (name === 'participants_orientation') return [orient({ id: 'p-1', others: [
      { id: 'p-2', full_name: 'Karol sophia Orozco camacho', email: 'r.miguel.ocampo.021208@gmail.com', origin: 'self_service', has_login: true,
        last_seen_at: new Date(Date.now() - 3 * 60_000).toISOString(), reservations_active: 2, attendances: 0, stamps: 0 }] })];
    return undefined;
  }) as never);
  show();
  await screen.findByText('Karol Orozco');
  expect(await screen.findByText('0 reservaciones')).toBeInTheDocument();
  expect(screen.getByText('Última actividad: hace 5 min')).toBeInTheDocument();
  expect(screen.getByText('Otra cuenta con el mismo teléfono')).toBeInTheDocument();
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('Esta cuenta está vacía');
  expect(note).toHaveTextContent('r.miguel.ocampo.021208@gmail.com');
  expect(screen.getByText('Karol sophia Orozco camacho')).toBeInTheDocument();
  expect(screen.getByText(/entró hace 3 min/)).toBeInTheDocument();
});

test('the list keeps working when the orientation or the dashboard fail', async () => {
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    if (name === 'search_participants') return [hit({})];
    throw new Error('boom');
  }) as never);
  show();
  expect(await screen.findByText('Ana López')).toBeInTheDocument();
  expect(screen.queryByRole('note')).toBeNull();
});
