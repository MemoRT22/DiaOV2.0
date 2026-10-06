import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuth } from '../lib/auth';
import { studentAccess } from '../lib/studentAccess';
import StudentLogin from './StudentLogin';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/studentAccess', () => ({
  studentAccess: { identify: vi.fn(), careers: vi.fn(), setupPassword: vi.fn(), register: vi.fn() },
}));
vi.mock('../components/themed', () => ({
  Backdrop: () => null, BrandFooter: () => null, Tagline: () => null, ThemedTitle: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({ theme: { meta: { eventName: 'Día OV' }, style: { glowRing: false } }, text: (key: string) => (key === 'loginTitle' ? 'Inicia tu exploración' : key) }),
}));
vi.mock('../edition/EditionProvider', () => ({
  useEdition: () => ({ edition: {
    event_date: '2026-10-20', start_time: '09:00', venue: 'Campus Cancún', privacy_notice_version: 'v1',
    privacy_notice_summary: 'Usaremos tus datos solo para el evento.', privacy_notice_url: 'https://example.test/aviso',
  } }),
}));

const signInParticipant = vi.fn();
const CAREERS = [
  { id: 'c-1', name: 'Psicología', division: 'Ciencias de la Salud' },
  { id: 'c-2', name: 'Derecho', division: 'Ciencias Jurídicas' },
];
const show = () => render(<MemoryRouter initialEntries={['/']}><Routes>
  <Route path="/" element={<StudentLogin />} />
  <Route path="/bitacora" element={<div>Bitácora</div>} />
</Routes></MemoryRouter>);

async function continueWith(email: string) {
  await userEvent.type(screen.getByLabelText('Correo electrónico'), email);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, signInParticipant } as unknown as ReturnType<typeof useAuth>);
  signInParticipant.mockResolvedValue(undefined);
  vi.mocked(studentAccess.careers).mockResolvedValue(CAREERS);
});

test('the first screen asks only for the email: no birth date, no password, no registration fields', () => {
  show();
  expect(screen.getByText('Inicia tu exploración')).toBeInTheDocument();
  expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/nacimiento/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
  expect(screen.queryByText(/fecha de nacimiento|módulo de registro|te dará de alta/i)).not.toBeInTheDocument();
});

test('an account that already exists continues with email + password through Supabase Auth', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('password_login');
  show();
  await continueWith('  Ana@Ejemplo.com ');
  expect(studentAccess.identify).toHaveBeenCalledWith('ana@ejemplo.com');
  expect(await screen.findByRole('heading', { name: 'Ingresa tu contraseña' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Contraseña'), 'mi-clave-segura');
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await waitFor(() => expect(signInParticipant).toHaveBeenCalledWith('ana@ejemplo.com', 'mi-clave-segura'));
  expect(screen.getByText(/¿No recuerdas tu contraseña\? Pide apoyo al personal del evento\./)).toBeInTheDocument();
  expect(studentAccess.setupPassword).not.toHaveBeenCalled();
  expect(studentAccess.register).not.toHaveBeenCalled();
});

test('a wrong password shows the single generic message', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('password_login');
  signInParticipant.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
  show();
  await continueWith('ana@ejemplo.com');
  await userEvent.type(await screen.findByLabelText('Contraseña'), 'incorrecta1');
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
});

test('a pre-registered participant without a password creates one and enters', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('password_setup');
  vi.mocked(studentAccess.setupPassword).mockResolvedValue(undefined);
  show();
  await continueWith('ana@ejemplo.com');
  expect(await screen.findByRole('heading', { name: 'Encontramos tu prerregistro' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'mi-clave-segura');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'mi-clave-segura');
  fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña y entrar' }));
  await waitFor(() => expect(studentAccess.setupPassword).toHaveBeenCalledWith('ana@ejemplo.com', 'mi-clave-segura'));
  await waitFor(() => expect(signInParticipant).toHaveBeenCalledWith('ana@ejemplo.com', 'mi-clave-segura'));
});

test('password setup validates length and confirmation before calling the server', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('password_setup');
  show();
  await continueWith('ana@ejemplo.com');
  await screen.findByRole('heading', { name: 'Encontramos tu prerregistro' });
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'corta');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'corta');
  fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña y entrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña debe tener entre 8 y 72 caracteres.');
  await userEvent.clear(screen.getByLabelText(/^Contraseña/));
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'mi-clave-segura');
  fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña y entrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
  expect(studentAccess.setupPassword).not.toHaveBeenCalled();
});

async function fillRegistration() {
  await userEvent.type(screen.getByLabelText('Nombre'), 'Ana María');
  await userEvent.type(screen.getByLabelText('Apellidos'), 'López Pérez');
  await userEvent.type(screen.getByLabelText('Teléfono con WhatsApp'), '9981234567');
  await userEvent.type(screen.getByLabelText('Escuela/preparatoria'), 'Colegio Ejemplo');
  await userEvent.selectOptions(screen.getByLabelText('Grado'), '3');
  await userEvent.selectOptions(screen.getByLabelText('Periodo de interés'), '2027-08');
  await userEvent.selectOptions(await screen.findByLabelText('Licenciatura'), 'c-1');
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'mi-clave-segura');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'mi-clave-segura');
}

test('an unknown email goes to self-registration with exactly the Forms fields and the privacy notice', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('self_registration');
  show();
  await continueWith('nueva@ejemplo.com');
  expect(await screen.findByText('No encontramos un prerregistro con este correo. Puedes registrarte ahora.')).toBeInTheDocument();
  for (const label of ['Nombre', 'Apellidos', /^Correo/, 'Teléfono con WhatsApp', 'Escuela/preparatoria', 'Grado', 'Periodo de interés', 'Licenciatura', 'Confirmar contraseña']) {
    expect(await screen.findByLabelText(label)).toBeInTheDocument();
  }
  expect(screen.getByLabelText(/^Correo/)).toHaveValue('nueva@ejemplo.com');
  expect(screen.queryByLabelText(/segunda|nacimiento/i)).not.toBeInTheDocument();
  const grade = screen.getByLabelText('Grado') as HTMLSelectElement;
  expect(Array.from(grade.options).map((o) => o.textContent)).toEqual(['Elige tu grado…', '1.º año', '2.º año', '3.º año', 'Egresado']);
  const period = screen.getByLabelText('Periodo de interés') as HTMLSelectElement;
  expect(Array.from(period.options).map((o) => o.textContent)).toEqual(['Elige el periodo…', 'Enero 2027', 'Agosto 2027', 'Enero 2028', 'Agosto 2028']);
  const careers = screen.getByLabelText('Licenciatura') as HTMLSelectElement;
  expect(Array.from(careers.options).map((o) => o.textContent)).toEqual(['Elige la licenciatura de tu interés…', 'Psicología', 'Derecho']);
  const notice = screen.getByRole('region', { name: 'Aviso de Privacidad' });
  expect(within(notice).getByText('Usaremos tus datos solo para el evento.')).toBeInTheDocument();
  expect(within(notice).getByRole('link', { name: 'Leer el aviso completo' })).toHaveAttribute('href', 'https://example.test/aviso');
});

test('registration requires accepting the privacy notice; then it creates the account and enters without repeating consent', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('self_registration');
  vi.mocked(studentAccess.register).mockResolvedValue(undefined);
  show();
  await continueWith('nueva@ejemplo.com');
  await screen.findByText(/No encontramos un prerregistro/);
  await fillRegistration();
  const submit = screen.getByRole('button', { name: 'Registrarme y entrar' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /acepto el Aviso de Privacidad y los términos/ }));
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(studentAccess.register).toHaveBeenCalledWith({
    email: 'nueva@ejemplo.com', password: 'mi-clave-segura', first_name: 'Ana María', last_name: 'López Pérez', phone: '9981234567',
    high_school: 'Colegio Ejemplo', high_school_grade: '3', entry_period: '2027-08', initial_career_id: 'c-1', consent_accepted: true,
  }));
  await waitFor(() => expect(signInParticipant).toHaveBeenCalledWith('nueva@ejemplo.com', 'mi-clave-segura'));
});

test('a duplicate email found at the last moment is reported clearly', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('self_registration');
  vi.mocked(studentAccess.register).mockRejectedValue(new Error('EMAIL_EXISTS'));
  show();
  await continueWith('nueva@ejemplo.com');
  await screen.findByText(/No encontramos un prerregistro/);
  await fillRegistration();
  fireEvent.click(screen.getByRole('checkbox', { name: /acepto el Aviso de Privacidad/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Registrarme y entrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Este correo ya está registrado.');
  expect(signInParticipant).not.toHaveBeenCalled();
});

test('the email can be changed from any step and nothing personal about the account is ever displayed', async () => {
  vi.mocked(studentAccess.identify).mockResolvedValue('password_login');
  show();
  await continueWith('ana@ejemplo.com');
  await screen.findByRole('heading', { name: 'Ingresa tu contraseña' });
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar correo' }));
  expect(await screen.findByLabelText('Correo electrónico')).toHaveValue('ana@ejemplo.com');
  expect(screen.queryByText(/Ana López|teléfono|escuela/i)).not.toBeInTheDocument();
});

test('an invalid or unavailable state is reported without exposing codes', async () => {
  vi.mocked(studentAccess.identify).mockRejectedValue(new Error('INVALID_EMAIL'));
  show();
  await continueWith('no-es-correo@x.co');
  expect(await screen.findByRole('alert')).toHaveTextContent('Escribe un correo válido.');
  expect(screen.queryByText('INVALID_EMAIL')).not.toBeInTheDocument();
});

test('a signed-in participant goes straight to the app', () => {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: { participant_id: 'p-1' }, signInParticipant } as unknown as ReturnType<typeof useAuth>);
  show();
  expect(screen.getByText('Bitácora')).toBeInTheDocument();
});
