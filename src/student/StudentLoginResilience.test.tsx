import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AccessError } from '../lib/accessErrors';
import { useAuth } from '../lib/auth';
import { studentAccess } from '../lib/studentAccess';
import StudentLogin from './StudentLogin';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
vi.mock('../lib/studentAccess', () => ({ studentAccess: { identify: vi.fn(), catalog: vi.fn(), setupPassword: vi.fn(), register: vi.fn() } }));
vi.mock('../components/themed', () => ({
  Backdrop: () => null, BrandFooter: () => null, Tagline: () => null, ThemedTitle: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({ theme: { meta: { eventName: 'Día OV' }, style: { glowRing: false } }, text: (key: string) => (key === 'loginTitle' ? 'Inicia tu exploración' : key) }),
}));
vi.mock('../edition/EditionProvider', () => ({
  useEdition: () => ({ edition: { event_date: '2026-10-20', start_time: '09:00', venue: 'Campus Cancún', privacy_notice_version: 'v1', privacy_notice_summary: 'Aviso.', privacy_notice_url: null } }),
}));

const signIn = vi.fn();
const SATURATED = 'Estamos recibiendo muchas solicitudes';
const BODY = 'Hay varios alumnos entrando a la plataforma al mismo tiempo. Tu información se conserva. Intenta nuevamente en unos momentos.';
const limited = (seconds?: number) => new AccessError('RATE_LIMITED', seconds);

const show = () => render(<MemoryRouter initialEntries={['/']}><Routes>
  <Route path="/" element={<StudentLogin />} />
  <Route path="/bitacora" element={<div>Bitácora</div>} />
</Routes></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, signInParticipant: signIn } as unknown as ReturnType<typeof useAuth>);
  signIn.mockResolvedValue(undefined);
  vi.mocked(studentAccess.catalog).mockResolvedValue({
    careers: [{ id: 'c-1', name: 'Psicología', division: 'Ciencias de la Salud' }],
    high_schools: [{ id: 'h-1', name: 'Colegio Ejemplo' }, { id: 'h-2', name: 'Otra escuela' }, { id: 'h-3', name: 'Colegio Tres' }, { id: 'h-4', name: 'Colegio Cuatro' }, { id: 'h-5', name: 'Colegio Cinco' }],
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const email = () => screen.getByLabelText('Correo electrónico') as HTMLInputElement;
async function identifyAs(state: 'password_login' | 'password_setup' | 'self_registration', address = 'ana@ejemplo.com') {
  vi.mocked(studentAccess.identify).mockResolvedValue(state);
  show();
  await userEvent.type(email(), address);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}
const retryButton = () => screen.getByRole('button', { name: 'Volver a intentar' });
const notice = () => screen.getByRole('alert');
const neverWrongPassword = () => expect(document.body).not.toHaveTextContent(/incorrectos?|contraseña incorrecta/i);

describe('identificar el correo', () => {
  test('con un 429 se muestra el aviso comprensible; el correo se conserva y no hay mensaje de contraseña', async () => {
    vi.mocked(studentAccess.identify).mockRejectedValue(limited(30));
    show();
    await userEvent.type(email(), 'ana@ejemplo.com');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    expect(notice()).toHaveTextContent(BODY);
    expect(email().value).toBe('ana@ejemplo.com'); // lo escrito se conserva
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    neverWrongPassword();
  });

  test('respeta Retry-After: lo comunica y mantiene el botón apagado solo ese tiempo, luego «Volver a intentar» continúa', async () => {
    vi.mocked(studentAccess.identify).mockRejectedValueOnce(limited(3)).mockResolvedValue('password_login');
    show();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    fireEvent.change(email(), { target: { value: 'ana@ejemplo.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(notice()).toHaveTextContent('Puedes volver a intentar en 3 segundos.');
    expect(retryButton()).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(notice()).toHaveTextContent('en 1 segundo.');
    expect(retryButton()).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(retryButton()).toBeEnabled(); // el bloqueo no es permanente
    fireEvent.click(retryButton());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByRole('heading', { name: 'Ingresa tu contraseña' })).toBeInTheDocument();
    expect(studentAccess.identify).toHaveBeenCalledTimes(2);
  });

  test('sin Retry-After la espera es corta y con variación aleatoria (nunca el mismo segundo para todos)', async () => {
    const seen = new Set<string>();
    for (let n = 0; n < 12; n += 1) {
      vi.mocked(studentAccess.identify).mockRejectedValue(limited());
      const view = show();
      await userEvent.type(email(), 'ana@ejemplo.com');
      fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
      await waitFor(() => expect(notice()).toHaveTextContent(/en (\d+) segundos?\./));
      const wait = Number(/en (\d+) segundos?\./.exec(notice().textContent ?? '')![1]);
      expect(wait).toBeGreaterThanOrEqual(8);
      expect(wait).toBeLessThanOrEqual(15);
      seen.add(String(wait));
      view.unmount();
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  test('un fallo de red usa su propio aviso y también conserva el correo', async () => {
    vi.mocked(studentAccess.identify).mockRejectedValue(new Error('NETWORK'));
    show();
    await userEvent.type(email(), 'ana@ejemplo.com');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(notice()).toHaveTextContent('No pudimos conectarnos'));
    expect(notice()).toHaveTextContent('Tu información se conserva');
    expect(email().value).toBe('ana@ejemplo.com');
    expect(retryButton()).toBeEnabled(); // sin espera que respetar
  });

  test('varios clics sobre el mismo botón envían una sola solicitud', async () => {
    let release: (state: 'password_login') => void = () => undefined;
    vi.mocked(studentAccess.identify).mockImplementation(() => new Promise((resolve) => { release = resolve as typeof release; }));
    show();
    await userEvent.type(email(), 'ana@ejemplo.com');
    const button = screen.getByRole('button', { name: 'Continuar' });
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    fireEvent.submit(button.closest('form')!);
    expect(studentAccess.identify).toHaveBeenCalledTimes(1);
    await act(async () => { release('password_login'); });
    expect(await screen.findByRole('heading', { name: 'Ingresa tu contraseña' })).toBeInTheDocument();
    expect(studentAccess.identify).toHaveBeenCalledTimes(1);
  });
});

describe('iniciar sesión', () => {
  test('una contraseña realmente incorrecta sigue diciéndolo', async () => {
    signIn.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    await identifyAs('password_login');
    await userEvent.type(await screen.findByLabelText('Contraseña'), 'incorrecta1');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).toBeNull();
  });

  test('con un 429 al iniciar sesión NO dice contraseña incorrecta: avisa, conserva lo escrito y reintenta con la misma contraseña', async () => {
    signIn.mockRejectedValueOnce(limited(0)).mockResolvedValue(undefined);
    await identifyAs('password_login');
    await userEvent.type(await screen.findByLabelText('Contraseña'), 'mi-clave-segura');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    neverWrongPassword();
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('mi-clave-segura');
    expect(screen.getByText('ana@ejemplo.com')).toBeInTheDocument(); // sigue en su paso, con su correo
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(signIn.mock.calls[1].slice(0, 2)).toEqual(['ana@ejemplo.com', 'mi-clave-segura']);
  });

  test('abandonar la pantalla (cambiar de correo) cancela lo que siga corriendo en segundo plano', async () => {
    let signal: AbortSignal | undefined;
    signIn.mockImplementation((_email: string, _password: string, options?: { signal?: AbortSignal }) => { signal = options?.signal; return new Promise(() => undefined); });
    await identifyAs('password_login');
    await userEvent.type(await screen.findByLabelText('Contraseña'), 'mi-clave-segura');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal!.aborted).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar correo' }));
    expect(signal!.aborted).toBe(true);
    expect(await screen.findByLabelText('Correo electrónico')).toHaveValue('ana@ejemplo.com'); // vuelve al correo ya identificado
  });
});

async function fillSetup(password = 'mi-clave-segura') {
  await userEvent.type(await screen.findByLabelText(/^Contraseña/), password);
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), password);
}
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña y entrar' }));

describe('prerregistrado que crea su contraseña', () => {
  test('la cuenta se creó pero el inicio de sesión quedó limitado: «Volver a intentar» repite SOLO la entrada, sin volver a crear nada', async () => {
    vi.mocked(studentAccess.setupPassword).mockResolvedValue(undefined);
    signIn.mockRejectedValueOnce(limited(0)).mockResolvedValue(undefined);
    await identifyAs('password_setup');
    await fillSetup();
    create();
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    expect(screen.getByText('Tu contraseña ya quedó creada. Solo falta entrar.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Contraseña/)).toBeDisabled(); // lo escrito no se puede cambiar a medias
    neverWrongPassword();
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(studentAccess.setupPassword).toHaveBeenCalledTimes(1); // nunca se vuelve a crear
    expect(signIn.mock.calls[1].slice(0, 2)).toEqual(['ana@ejemplo.com', 'mi-clave-segura']);
  });

  test('un 429 al crear la cuenta conserva lo escrito y el reintento vuelve a crearla (el servidor recupera lo que quedó a medias)', async () => {
    vi.mocked(studentAccess.setupPassword).mockRejectedValueOnce(limited(0)).mockResolvedValue(undefined);
    await identifyAs('password_setup');
    await fillSetup();
    create();
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    expect((screen.getByLabelText(/^Contraseña/) as HTMLInputElement).value).toBe('mi-clave-segura');
    expect((screen.getByLabelText('Confirmar contraseña') as HTMLInputElement).value).toBe('mi-clave-segura');
    expect(screen.getByRole('heading', { name: 'Encontramos tu prerregistro' })).toBeInTheDocument(); // sigue en su paso
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(studentAccess.setupPassword).toHaveBeenCalledTimes(2);
  });

  test('respuesta perdida con la cuenta ya creada: al reintentar el servidor dice «ya configurada» y se entra con la misma contraseña', async () => {
    vi.mocked(studentAccess.setupPassword).mockRejectedValueOnce(new Error('TIMEOUT')).mockRejectedValueOnce(new Error('ACCESS_ALREADY_CONFIGURED'));
    await identifyAs('password_setup');
    await fillSetup();
    create();
    await waitFor(() => expect(notice()).toHaveTextContent('La conexión tardó demasiado'));
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('ana@ejemplo.com', 'mi-clave-segura', expect.anything()));
    expect(screen.queryByText(/ya tiene una contraseña/)).toBeNull();
  });

  test('si esa contraseña no es la de la cuenta existente, pasa a «iniciar sesión» con el mismo correo y lo explica (no se cambia nada ajeno)', async () => {
    vi.mocked(studentAccess.setupPassword).mockRejectedValueOnce(new Error('NETWORK')).mockRejectedValueOnce(new Error('ACCESS_ALREADY_CONFIGURED'));
    signIn.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    await identifyAs('password_setup');
    await fillSetup('otra-clave-nueva');
    create();
    await waitFor(() => expect(notice()).toHaveTextContent('No pudimos conectarnos'));
    fireEvent.click(retryButton());
    expect(await screen.findByRole('heading', { name: 'Ingresa tu contraseña' })).toBeInTheDocument();
    expect(screen.getByText('Este correo ya tiene una contraseña. Inicia sesión con ella.')).toBeInTheDocument();
    expect(screen.getByText('ana@ejemplo.com')).toBeInTheDocument();
    expect(studentAccess.setupPassword).toHaveBeenCalledTimes(2); // no hubo un tercer intento de configurarla
  });

  test('«ya configurada» en el PRIMER intento (sin nada incierto antes) solo informa: no se intenta entrar a ciegas', async () => {
    vi.mocked(studentAccess.setupPassword).mockRejectedValue(new Error('ACCESS_ALREADY_CONFIGURED'));
    await identifyAs('password_setup');
    await fillSetup();
    create();
    expect(await screen.findByRole('alert')).toHaveTextContent('Este correo ya tiene una contraseña. Inicia sesión con ella.');
    expect(signIn).not.toHaveBeenCalled();
  });
});

async function fillRegistration() {
  await userEvent.type(await screen.findByLabelText('Nombre'), 'Ana María');
  await userEvent.type(screen.getByLabelText('Apellidos'), 'López Pérez');
  await userEvent.type(screen.getByLabelText('Teléfono con WhatsApp'), '9981234567');
  fireEvent.click(screen.getByRole('combobox', { name: 'Escuela/preparatoria' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Buscar preparatoria' }), 'Ejemplo');
  fireEvent.click(screen.getByRole('button', { name: 'Colegio Ejemplo' }));
  await userEvent.selectOptions(screen.getByLabelText('Grado'), '3');
  await userEvent.selectOptions(screen.getByLabelText('Periodo de interés'), '2027-08');
  await userEvent.selectOptions(await screen.findByLabelText('Licenciatura'), 'c-1');
  await userEvent.type(screen.getByLabelText(/^Contraseña/), 'mi-clave-segura');
  await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'mi-clave-segura');
  fireEvent.click(screen.getByRole('checkbox', { name: 'He leído y acepto el Aviso de Privacidad.' }));
}
const register = () => fireEvent.click(screen.getByRole('button', { name: 'Registrarme y entrar' }));
const registered = () => vi.mocked(studentAccess.register);

describe('autorregistro', () => {
  test('un 429 conserva TODOS los campos y el consentimiento; el reintento vuelve a enviar el registro una sola vez por clic', async () => {
    registered().mockRejectedValueOnce(limited(0)).mockResolvedValue(undefined);
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Ana María');
    expect((screen.getByLabelText('Apellidos') as HTMLInputElement).value).toBe('López Pérez');
    expect((screen.getByLabelText('Teléfono con WhatsApp') as HTMLInputElement).value).toBe('9981234567');
    expect((screen.getByLabelText('Licenciatura') as HTMLSelectElement).value).toBe('c-1');
    expect(screen.getByRole('checkbox', { name: 'He leído y acepto el Aviso de Privacidad.' })).toBeChecked();
    expect(screen.getByLabelText(/^Correo/)).toHaveValue('nueva@ejemplo.com');
    neverWrongPassword();
    const again = retryButton();
    fireEvent.click(again); fireEvent.click(again); // dos clics seguidos
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(registered()).toHaveBeenCalledTimes(2); // el primero limitado + un solo reintento
    expect(registered().mock.calls[1][0]).toEqual(registered().mock.calls[0][0]); // exactamente los mismos datos
  });

  test('registro guardado pero entrada limitada: el reintento repite solo la entrada y los campos quedan fijos', async () => {
    registered().mockResolvedValue(undefined);
    signIn.mockRejectedValueOnce(limited(0)).mockResolvedValue(undefined);
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    await waitFor(() => expect(notice()).toHaveTextContent(SATURATED));
    expect(screen.getByText('Tu registro ya quedó guardado. Solo falta entrar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(registered()).toHaveBeenCalledTimes(1);
  });

  test('respuesta perdida con el registro ya hecho: el reintento (correo ya existe) entra con la contraseña escrita', async () => {
    registered().mockRejectedValueOnce(new Error('TIMEOUT')).mockRejectedValueOnce(new Error('EMAIL_EXISTS'));
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    await waitFor(() => expect(notice()).toHaveTextContent('La conexión tardó demasiado'));
    fireEvent.click(retryButton());
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('nueva@ejemplo.com', 'mi-clave-segura', expect.anything()));
  });

  test('si esa contraseña no corresponde a la cuenta existente, pasa a iniciar sesión sin duplicar ni alterar nada', async () => {
    registered().mockRejectedValueOnce(new Error('NETWORK')).mockRejectedValueOnce(new Error('EMAIL_EXISTS'));
    signIn.mockRejectedValue(new Error('INVALID_CREDENTIALS'));
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    await waitFor(() => expect(notice()).toHaveTextContent('No pudimos conectarnos'));
    fireEvent.click(retryButton());
    expect(await screen.findByRole('heading', { name: 'Ingresa tu contraseña' })).toBeInTheDocument();
    expect(screen.getByText(/Este correo ya está registrado\. Inicia sesión con tu contraseña\./)).toBeInTheDocument();
    expect(registered()).toHaveBeenCalledTimes(2);
  });

  test('un duplicado real en el primer intento sigue siendo «ya registrado» (sin intentar entrar a ciegas)', async () => {
    registered().mockRejectedValue(new Error('EMAIL_EXISTS'));
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    expect(await screen.findByRole('alert')).toHaveTextContent('Este correo ya está registrado.');
    expect(signIn).not.toHaveBeenCalled();
  });

  test('un error de datos del servidor (no temporal) se muestra tal cual y no ofrece «Volver a intentar»', async () => {
    registered().mockRejectedValue(new Error('INVALID_PHONE'));
    await identifyAs('self_registration', 'nueva@ejemplo.com');
    await fillRegistration();
    register();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrarme y entrar' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Aviso de Privacidad' })).getByRole('checkbox')).toBeChecked();
  });
});
