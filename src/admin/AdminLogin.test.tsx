import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { AccessError } from '../lib/accessErrors';
import { useAuth } from '../lib/auth';
import AdminLogin from './AdminLogin';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
const signInStaff = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(useAuth).mockReturnValue({ session: null, staff: null, profile: null, signInStaff, signOut: vi.fn() } as unknown as ReturnType<typeof useAuth>);
});

async function submit() {
  render(<MemoryRouter><AdminLogin /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Correo'), 'staff@anahuac.mx');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-staff-1');
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

test('Staff: wrong credentials keep their message', async () => {
  signInStaff.mockRejectedValue(new Error('INVALID_STAFF_CREDENTIALS'));
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
});

test('Staff: a 429 is explained as saturation — never as wrong credentials — and what was typed is kept', async () => {
  signInStaff.mockRejectedValue(new AccessError('RATE_LIMITED', 20));
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Estamos recibiendo muchas solicitudes. Tu información se conserva. Intenta nuevamente en unos momentos.');
  expect(screen.getByRole('alert')).not.toHaveTextContent(/incorrectos/);
  expect((screen.getByLabelText('Correo') as HTMLInputElement).value).toBe('staff@anahuac.mx');
  expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('clave-staff-1');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled()); // se puede reintentar
});

test('Staff: two quick submits send one request', async () => {
  let release: () => void = () => undefined;
  signInStaff.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  await submit();
  fireEvent.submit(screen.getByRole('button', { name: /Entrar/ }).closest('form')!);
  expect(signInStaff).toHaveBeenCalledTimes(1);
  release();
});

test('Staff: a successful sign-in is unchanged', async () => {
  signInStaff.mockResolvedValue(undefined);
  await submit();
  await waitFor(() => expect(signInStaff).toHaveBeenCalledWith('staff@anahuac.mx', 'clave-staff-1', { signal: expect.any(AbortSignal) }));
});

test('Staff: leaving the screen aborts the sign-in (retries stop and an in-flight result is discarded), and shows nothing afterwards', async () => {
  let signal: AbortSignal | undefined;
  let release: () => void = () => undefined;
  signInStaff.mockImplementation((_email: string, _password: string, options?: { signal?: AbortSignal }) => new Promise<void>((_resolve, reject) => {
    signal = options?.signal;
    release = () => reject(new Error('ABORTED'));
  }));
  const view = render(<MemoryRouter><AdminLogin /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Correo'), 'staff@anahuac.mx');
  await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-staff-1');
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  await waitFor(() => expect(signal).toBeDefined());
  expect(signal!.aborted).toBe(false);
  view.unmount();
  expect(signal!.aborted).toBe(true); // se canceló al desmontar
  release();
  await Promise.resolve();
  expect(console.error).not.toHaveBeenCalled(); // sin avisos de estado en un componente desmontado
});

test('Staff: an aborted attempt never shows an error message', async () => {
  signInStaff.mockRejectedValue(new Error('ABORTED'));
  await submit();
  await waitFor(() => expect(signInStaff).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled());
});
