import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { useAuth, type StaffRole } from '../../lib/auth';
import ParticipantDetail from './ParticipantDetail';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchCareers: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/auth')>(), useAuth: vi.fn() }));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { privacy_notice_version: 'v1' } }) }));

const access = { failed: 0, locked: false, locked_until: null, last_success: null };
let detail: Record<string, unknown>;
let conflicts: Array<Record<string, unknown>>;

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ staff: { user_id: 's', full_name: 'Persona', roles } } as unknown as ReturnType<typeof useAuth>);
}
const show = () => render(<MemoryRouter initialEntries={['/coordinacion/participantes/p-1']}><Routes>
  <Route path="/coordinacion/participantes/:id" element={<ParticipantDetail />} />
</Routes></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  role(['coordinacion']);
  detail = { id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', birth_date: '2008-03-15', phone: null, high_school: null,
    initial_career_id: null, initial_career_raw: null, origin: 'forms', is_demo: false, forms_consent: true, forms_consent_at: null,
    manual_consent_at: null, manual_consent_by: null, manual_overrides: {}, pending_conflicts: 0, has_logged_in: true,
    platform_consent_at: '2026-10-05T10:00:00Z', attendances: 0, access };
  conflicts = [];
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'get_participant') return detail as never;
    if (name === 'list_import_conflicts') return conflicts as never;
    return undefined as never;
  });
});

test('the expediente diagnoses access: everything in order', async () => {
  show();
  const card = await screen.findByRole('region', { name: 'Diagnóstico de acceso' });
  expect(within(card).getByText('Puede entrar con su correo y fecha de nacimiento')).toBeInTheDocument();
  expect(within(card).getByText('Tiene fecha de nacimiento')).toBeInTheDocument();
  expect(within(card).getByText('Sin bloqueo de acceso')).toBeInTheDocument();
  expect(within(card).getByText(/Ya entró/)).toBeInTheDocument();
  expect(within(card).getByText(/Aceptó el aviso de privacidad/)).toBeInTheDocument();
});

test('a missing birth date is explained and can be corrected from the diagnosis', async () => {
  detail = { ...detail, birth_date: null, has_logged_in: false, platform_consent_at: null };
  show();
  const card = await screen.findByRole('region', { name: 'Diagnóstico de acceso' });
  expect(within(card).getByText('Tiene problemas para entrar')).toBeInTheDocument();
  expect(within(card).getByText('Falta la fecha de nacimiento')).toBeInTheDocument();
  expect(within(card).getByText(/Todavía no ha entrado/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Corregir datos' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test('an access lock is explained and can be removed, then the expediente reloads', async () => {
  let locked = true;
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'get_participant') return { ...detail, access: { ...access, locked, failed: locked ? 5 : 0, locked_until: locked ? '2026-10-06T18:15:00Z' : null } } as never;
    if (name === 'clear_access_lock') { locked = false; return undefined as never; }
    return [] as never;
  });
  show();
  const card = await screen.findByRole('region', { name: 'Diagnóstico de acceso' });
  expect(within(card).getByText('Bloqueado temporalmente')).toBeInTheDocument();
  expect(within(card).getByText(/Por 5 intentos fallidos/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: /Retirar bloqueo/ }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('clear_access_lock', { p_id: 'p-1' }));
  expect(await screen.findByText('Sin bloqueo de acceso')).toBeInTheDocument();
});

test('import conflicts of this participant are resolved inside the expediente', async () => {
  detail = { ...detail, pending_conflicts: 1 };
  conflicts = [
    { id: 'c-1', participant_id: 'p-1', field: 'phone', full_name: 'Ana López', email: 'ana@correo.com', imported_value: '998111',
      current_value: '998222', corrected_by: 'Ena', corrected_at: '2026-10-05T10:00:00Z', created_at: '2026-10-06T10:00:00Z' },
    { id: 'c-2', participant_id: 'other', field: 'phone', full_name: 'Otra', email: 'o@correo.com', imported_value: '1', current_value: '2',
      corrected_by: null, corrected_at: null, created_at: '2026-10-06T10:00:00Z' },
  ];
  show();
  const review = await screen.findByRole('region', { name: 'Datos pendientes de revisión de este participante' });
  expect(within(review).getAllByRole('listitem')).toHaveLength(1);
  expect(within(review).getByText('998222')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Resolver' })).not.toBeInTheDocument();
  fireEvent.click(within(review).getByRole('button', { name: 'Conservar corrección manual' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('resolve_import_conflict', { p_id: 'c-1', p_accept: false }));
});

test('staff sees that Coordinación must resolve conflicts and never calls the coordination-only RPC', async () => {
  role(['staff']);
  detail = { ...detail, pending_conflicts: 2 };
  show();
  expect(await screen.findByText(/Coordinación debe resolverlos/)).toBeInTheDocument();
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).not.toContain('list_import_conflicts');
});
