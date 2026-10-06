import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { resetParticipantPassword } from '../../lib/participantAdminApi';
import PasswordAccess from './PasswordAccess';

vi.mock('../../lib/participantAdminApi', () => ({ resetParticipantPassword: vi.fn() }));

const onChanged = vi.fn();
const show = (over: Partial<React.ComponentProps<typeof PasswordAccess>> = {}) =>
  render(<PasswordAccess participantId="p-1" accessConfigured hasLoggedIn={false} platformConsentAt={null} onChanged={onChanged} {...over} />);
const openModal = () => fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

test('generate is the default: the password comes from the server and is shown once, with a copy button', async () => {
  vi.mocked(resetParticipantPassword).mockResolvedValue({ ok: true, generated: true, password: 'Xk7mP3qRtz' });
  show();
  openModal();
  const dialog = await screen.findByRole('dialog', { name: 'Restablecer contraseña' });
  expect(within(dialog).getByRole('radio', { name: /Generar una contraseña/ })).toBeChecked();
  expect(within(dialog).queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
  expect(within(dialog).getByText(/No se envía ningún correo ni código/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restablecer contraseña' }));
  const done = await screen.findByRole('dialog', { name: 'Contraseña restablecida' });
  expect(resetParticipantPassword).toHaveBeenCalledWith('p-1', undefined);
  expect(within(done).getByLabelText('Contraseña generada')).toHaveTextContent('Xk7mP3qRtz');
  expect(within(done).getByText(/Se muestra una sola vez y no se guarda/)).toBeInTheDocument();
  fireEvent.click(within(done).getByRole('button', { name: 'Copiar' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Xk7mP3qRtz'));
  expect(await within(done).findByRole('button', { name: 'Copiada' })).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
  fireEvent.click(within(done).getByRole('button', { name: 'Listo' }));
  expect(screen.queryByText('Xk7mP3qRtz')).not.toBeInTheDocument();
});

test('define lets the operator type the password; it is never displayed again afterwards', async () => {
  vi.mocked(resetParticipantPassword).mockResolvedValue({ ok: true, generated: false });
  show();
  openModal();
  fireEvent.click(screen.getByRole('radio', { name: /Definir una contraseña/ }));
  await userEvent.type(await screen.findByLabelText(/Nueva contraseña/), 'Definida-por-Staff-1');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await screen.findByRole('dialog', { name: 'Contraseña restablecida' })).toBeInTheDocument();
  expect(resetParticipantPassword).toHaveBeenCalledWith('p-1', 'Definida-por-Staff-1');
  expect(screen.queryByText('Definida-por-Staff-1')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Contraseña generada')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copiar' })).not.toBeInTheDocument();
});

test('a too-short manual password is rejected before reaching the server', async () => {
  show();
  openModal();
  fireEvent.click(screen.getByRole('radio', { name: /Definir una contraseña/ }));
  await userEvent.type(await screen.findByLabelText(/Nueva contraseña/), 'corta');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña debe tener entre 8 y 72 caracteres.');
  expect(resetParticipantPassword).not.toHaveBeenCalled();
});

test('server errors are explained without raw codes and nothing changes', async () => {
  vi.mocked(resetParticipantPassword).mockRejectedValue(new Error('EMAIL_EXISTS'));
  show();
  openModal();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Este correo ya está registrado.');
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByText('EMAIL_EXISTS')).not.toBeInTheDocument();
});

test('the unconfigured state is explained and the same action creates the account', async () => {
  vi.mocked(resetParticipantPassword).mockResolvedValue({ ok: true, generated: true, password: 'Ab3dEf5hJk' });
  show({ accessConfigured: false });
  expect(screen.getByText('Acceso no configurado')).toBeInTheDocument();
  expect(screen.queryByText('Cuenta activa')).not.toBeInTheDocument();
  openModal();
  expect(await screen.findByText(/todavía no tiene contraseña/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restablecer contraseña' }));
  expect(await screen.findByRole('dialog', { name: 'Contraseña configurada' })).toBeInTheDocument();
});

test('there is no recovery by email, code or link', () => {
  show();
  openModal();
  expect(screen.queryByText(/enlace|código de verificación|enviar correo|OTP/i)).not.toBeInTheDocument();
});
