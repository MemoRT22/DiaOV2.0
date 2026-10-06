import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { useAuth, type StaffRole } from '../../lib/auth';
import { resetParticipantPassword } from '../../lib/participantAdminApi';
import ParticipantDetail from './ParticipantDetail';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchCareers: vi.fn().mockResolvedValue([]) }));
vi.mock('../../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/auth')>(), useAuth: vi.fn() }));
vi.mock('../../lib/participantAdminApi', () => ({ resetParticipantPassword: vi.fn() }));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { privacy_notice_version: 'v1' } }) }));

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
  detail = { id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', phone: null, high_school: null,
    high_school_grade: '3', entry_period: '2027-08', initial_career_id: null, initial_career_raw: null, origin: 'forms',
    is_demo: false, forms_consent: true, forms_consent_at: null, manual_consent_at: null, manual_consent_by: null,
    manual_overrides: {}, pending_conflicts: 0, has_logged_in: true, access_configured: true,
    platform_consent_at: '2026-10-05T10:00:00Z', platform_consent_source: 'platform', attendances: 0 };
  conflicts = [];
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'get_participant') return detail as never;
    if (name === 'list_import_conflicts') return conflicts as never;
    return undefined as never;
  });
});

test('the expediente shows the structural fields and never a birth date', async () => {
  show();
  await screen.findByRole('heading', { name: 'Ana López' });
  const record = screen.getByText('Datos del registro').closest('section') as HTMLElement;
  expect(within(record).getByText('Grado')).toBeInTheDocument();
  expect(within(record).getByText('3.º año')).toBeInTheDocument();
  expect(within(record).getByText('Periodo de interés')).toBeInTheDocument();
  expect(within(record).getByText('Agosto 2027')).toBeInTheDocument();
  expect(screen.queryByText(/nacimiento/i)).not.toBeInTheDocument();
});

test('an active account is shown as such, with no diagnosis of birth date or lock', async () => {
  show();
  const card = await screen.findByRole('region', { name: 'Acceso a la plataforma' });
  expect(within(card).getByText('Cuenta activa')).toBeInTheDocument();
  expect(within(card).getByText(/Ya entró a la plataforma/)).toBeInTheDocument();
  expect(within(card).getByText(/Aceptó el aviso de privacidad/)).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Restablecer contraseña' })).toBeInTheDocument();
  expect(screen.queryByText(/bloqueo|Bloqueado|fecha de nacimiento/i)).not.toBeInTheDocument();
});

test('a participant without a password shows "Acceso no configurado" and can still get one from the expediente', async () => {
  detail = { ...detail, access_configured: false, has_logged_in: false, platform_consent_at: null };
  show();
  const card = await screen.findByRole('region', { name: 'Acceso a la plataforma' });
  expect(within(card).getByText('Acceso no configurado')).toBeInTheDocument();
  expect(within(card).getByText(/Todavía no crea su contraseña/)).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await screen.findByText(/todavía no tiene contraseña/)).toBeInTheDocument();
});

test('resetting generates a password shown once to the operator, then the expediente reloads', async () => {
  let configured = false;
  detail = { ...detail, access_configured: false };
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'get_participant') return { ...detail, access_configured: configured } as never;
    return [] as never;
  });
  vi.mocked(resetParticipantPassword).mockImplementation(async () => { configured = true; return { ok: true, generated: true, password: 'Xk7mP3qRtz' }; });
  show();
  const card = await screen.findByRole('region', { name: 'Acceso a la plataforma' });
  fireEvent.click(within(card).getByRole('button', { name: 'Restablecer contraseña' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await within(await screen.findByRole('dialog')).findByLabelText('Contraseña generada')).toHaveTextContent('Xk7mP3qRtz');
  expect(resetParticipantPassword).toHaveBeenCalledWith('p-1', undefined);
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Acceso a la plataforma' })).getByText('Cuenta activa')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
  await waitFor(() => expect(screen.queryByText('Xk7mP3qRtz')).not.toBeInTheDocument());
  // el expediente nunca pide ni guarda la contraseña: solo se consulta el detalle
  expect(vi.mocked(rpc).mock.calls.every(([, args]) => !JSON.stringify(args ?? {}).includes('Xk7mP3qRtz'))).toBe(true);
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
