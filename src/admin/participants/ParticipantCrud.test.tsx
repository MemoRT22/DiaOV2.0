import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { fetchCareers, fetchHighSchools } from '../../lib/catalog';
import { useAuth, type StaffRole } from '../../lib/auth';
import { createParticipant, deleteParticipant, fetchParticipantDeletePreview, type ParticipantDeletePreview } from '../../lib/participantAdminApi';
import ParticipantDetail from './ParticipantDetail';
import Participants from './Participants';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchCareers: vi.fn(), fetchHighSchools: vi.fn() }));
vi.mock('../../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/auth')>(), useAuth: vi.fn() }));
vi.mock('../../lib/participantAdminApi', () => ({
  resetParticipantPassword: vi.fn(), createParticipant: vi.fn(), deleteParticipant: vi.fn(), fetchParticipantDeletePreview: vi.fn(),
}));
vi.mock('../../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { privacy_notice_version: 'v1' } }) }));

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ staff: { user_id: 's', full_name: 'Persona', roles } } as unknown as ReturnType<typeof useAuth>);
}
const detail = {
  id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', phone: null, high_school: null, high_school_id: null,
  high_school_grade: null, entry_period: null, initial_career_id: null, initial_career_raw: null, origin: 'manual',
  is_demo: false, forms_consent: null, forms_consent_at: null, manual_consent_at: null, manual_consent_by: null,
  manual_overrides: {}, pending_conflicts: 0, has_logged_in: false, access_configured: false,
  platform_consent_at: null, platform_consent_source: null, attendances: 0,
};
const preview = (over: Partial<ParticipantDeletePreview> = {}): ParticipantDeletePreview => ({
  id: 'p-1', full_name: 'Ana López', email: 'ana@correo.com', is_demo: false, reservations: 0, attendances: 0, stamps: 0,
  initial_interests: 0, post_event_interests: 0, email_aliases: 0, import_conflicts: 0, raffle_records: 0, raffle_confirmed: 0,
  has_account: false, account_will_be_deleted: false, ...over,
});

function Listing() {
  const state = useLocation().state as { notice?: string } | null;
  return <div>Lista de participantes{state?.notice ? ` · ${state.notice}` : ''}</div>;
}
const showList = () => render(<MemoryRouter initialEntries={['/coordinacion/participantes']}><Routes>
  <Route path="/coordinacion/participantes" element={<Participants />} />
  <Route path="/coordinacion/participantes/:id" element={<ParticipantDetail />} />
</Routes></MemoryRouter>);
const showDetail = () => render(<MemoryRouter initialEntries={['/coordinacion/participantes/p-1']}><Routes>
  <Route path="/coordinacion/participantes" element={<Listing />} />
  <Route path="/coordinacion/participantes/:id" element={<ParticipantDetail />} />
</Routes></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  role(['coordinacion']);
  vi.mocked(fetchCareers).mockResolvedValue([
    { id: 'c-med', code: 'MED', name: 'Medicina', division_id: 'd', is_active: true, is_demo: false },
    { id: 'c-demo', code: 'DEMO', name: 'Carrera de prueba', division_id: 'd', is_active: true, is_demo: true },
  ]);
  vi.mocked(fetchHighSchools).mockResolvedValue([]);
  vi.mocked(rpc).mockImplementation((async (name: string) => {
    if (name === 'search_participants') return [];
    if (name === 'get_participant') return detail;
    if (name === 'list_import_conflicts') return [];
    return undefined;
  }) as never);
});

// --------------------------------------------------------------------------------------------------- alta manual

test('only Coordinación can add a participant by hand', async () => {
  role(['staff']);
  showList();
  await screen.findByText('Aún no hay participantes registrados en esta edición.');
  expect(screen.queryByRole('button', { name: 'Nuevo participante' })).not.toBeInTheDocument();
});

test('manual sign-up asks for e-mail and name only, never for consent or a password, and opens the new file', async () => {
  vi.mocked(createParticipant).mockResolvedValue('p-1');
  showList();
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText(/configura su contraseña y acepta el Aviso de Privacidad/)).toBeInTheDocument();
  expect(dialog.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(dialog.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  expect(dialog.getByLabelText('Correo')).toBeRequired();
  expect(dialog.getByLabelText('Nombre completo')).toBeRequired();
  expect(dialog.getByLabelText(/Teléfono/)).not.toBeRequired();
  // DEMO careers are not offered for a real participant
  expect(dialog.getByRole('option', { name: 'Medicina' })).toBeInTheDocument();
  expect(dialog.queryByRole('option', { name: 'Carrera de prueba' })).not.toBeInTheDocument();

  fireEvent.change(dialog.getByLabelText('Correo'), { target: { value: '  ana@correo.com ' } });
  fireEvent.change(dialog.getByLabelText('Nombre completo'), { target: { value: ' Ana López ' } });
  fireEvent.change(dialog.getByLabelText('Carrera de interés inicial'), { target: { value: 'c-med' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Crear participante' }));

  await waitFor(() => expect(createParticipant).toHaveBeenCalledTimes(1));
  // empty optional fields are not sent
  expect(createParticipant).toHaveBeenCalledWith({ email: 'ana@correo.com', full_name: 'Ana López', initial_career_id: 'c-med' });
  // lands on the new participant's file, which explains that access is still to be configured
  expect(await screen.findByRole('heading', { name: 'Ana López' })).toBeInTheDocument();
  expect(screen.getByText(/Participante creado\. Aún no tiene acceso configurado/)).toBeInTheDocument();
});

test('a duplicate e-mail is explained and nothing is created', async () => {
  vi.mocked(createParticipant).mockRejectedValue(new Error('EMAIL_EXISTS'));
  showList();
  fireEvent.click(await screen.findByRole('button', { name: 'Nuevo participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText('Correo'), { target: { value: 'ana@correo.com' } });
  fireEvent.change(dialog.getByLabelText('Nombre completo'), { target: { value: 'Ana López' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Crear participante' }));
  expect(await dialog.findByText('Este correo ya está registrado.')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Crear participante' })).toBeEnabled();
});

// ---------------------------------------------------------------------------------------------------- eliminar

test('Staff can correct data but never sees «Eliminar participante»', async () => {
  role(['staff']);
  showDetail();
  await screen.findByRole('heading', { name: 'Ana López' });
  expect(screen.getByRole('button', { name: 'Corregir datos' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Eliminar participante' })).not.toBeInTheDocument();
});

test('deleting a participant lists everything that goes with them and needs a typed confirmation', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockResolvedValue(preview({
    reservations: 3, attendances: 2, stamps: 3, initial_interests: 2, post_event_interests: 1, email_aliases: 1,
    raffle_records: 2, raffle_confirmed: 1, has_account: true, account_will_be_deleted: true,
  }));
  vi.mocked(deleteParticipant).mockResolvedValue({ account: 'deleted' });
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(fetchParticipantDeletePreview).toHaveBeenCalledWith('p-1');
  expect(dialog.getByText(/Esta acción no se puede deshacer/)).toBeInTheDocument();
  expect(within(dialog.getByRole('list', { name: 'Datos que se eliminarán' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    '3 reservaciones', '2 asistencias (3 sellos)', '3 intereses vocacionales', '1 correo anterior',
    '2 registros de sorteo (incluye un premio confirmado, que volverá a estar disponible)', 'Su cuenta de acceso (ya no podrá entrar)',
  ]);

  const confirm = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  expect(confirm).toBeDisabled();
  expect(deleteParticipant).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(deleteParticipant).toHaveBeenCalledWith('p-1'));
  expect(deleteParticipant).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Lista de participantes · Ana López fue eliminado.')).toBeInTheDocument();
});

test('a participant with nothing related says so', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockResolvedValue(preview());
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('No tiene reservaciones, asistencias, intereses ni cuenta de acceso.')).toBeInTheDocument();
  expect(dialog.queryByRole('list')).not.toBeInTheDocument();
});

test('a linked account that is not a participant identity is announced as kept, before and after', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockResolvedValue(preview({ reservations: 1, has_account: true, account_will_be_deleted: false }));
  vi.mocked(deleteParticipant).mockResolvedValue({ account: 'kept_not_participant' });
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText(/La cuenta vinculada no es de participante \(por ejemplo, de Staff\): se conservará intacta/)).toBeInTheDocument();
  expect(dialog.queryByText(/Su cuenta de acceso \(ya no podrá entrar\)/)).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
  expect(await screen.findByText(/Ana López fue eliminado\. La cuenta vinculada no era de participante y se conservó\./)).toBeInTheDocument();
});

test('if the account cannot be removed nothing is deleted and the participant stays on screen', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockResolvedValue(preview({ has_account: true, account_will_be_deleted: true }));
  vi.mocked(deleteParticipant).mockRejectedValue(new Error('AUTH_DELETE_FAILED'));
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
  expect(await dialog.findByText('No se pudo retirar la cuenta de acceso, así que no se eliminó nada. Inténtalo de nuevo.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Ana López' })).toBeInTheDocument();
  expect(screen.queryByText(/Lista de participantes/)).not.toBeInTheDocument();
});

test('when Auth cannot be consulted nothing is deleted, the reason is clear and retrying completes the deletion', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockResolvedValue(preview({ reservations: 1, has_account: true, account_will_be_deleted: true }));
  vi.mocked(deleteParticipant).mockRejectedValueOnce(new Error('AUTH_UNAVAILABLE')).mockResolvedValueOnce({ account: 'deleted' });
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  const dialog = within(await screen.findByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Escribe "ELIMINAR"/), { target: { value: 'ELIMINAR' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Eliminar definitivamente' }));
  expect(await dialog.findByText('No se pudo consultar la cuenta de acceso en este momento, así que no se eliminó nada. Inténtalo de nuevo en unos segundos.')).toBeInTheDocument();
  // still on the participant's file, with the confirmation open and ready for another try
  expect(screen.getByRole('heading', { name: 'Ana López' })).toBeInTheDocument();
  expect(screen.queryByText(/Lista de participantes/)).not.toBeInTheDocument();
  const retry = dialog.getByRole('button', { name: 'Eliminar definitivamente' });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  expect(await screen.findByText('Lista de participantes · Ana López fue eliminado.')).toBeInTheDocument();
  expect(deleteParticipant).toHaveBeenCalledTimes(2);
});

test('a failed preview opens no confirmation', async () => {
  vi.mocked(fetchParticipantDeletePreview).mockRejectedValue(new Error('NOT_AUTHORIZED'));
  showDetail();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar participante' }));
  expect(await screen.findByText(/No se pudo preparar la eliminación/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(deleteParticipant).not.toHaveBeenCalled();
});
