import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import CheckinModule from './CheckinModule';

const mock = vi.hoisted(() => ({ overview: vi.fn(), credential: vi.fn(), regenerate: vi.fn() }));
vi.mock('../lib/checkin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/checkin')>()),
  fetchCheckinOverview: mock.overview,
  fetchActivityCredentialDisplay: mock.credential,
  regenerateActivityCredential: mock.regenerate,
}));
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  useAuth: () => ({ staff: { user_id: 'coord', full_name: 'Coordinación', roles: ['coordinacion'] } }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAA') } }));

const session = (id: string) => ({ session_id: id, starts_at: '2026-10-12T17:00:00Z', ends_at: '2026-10-12T18:00:00Z', status: 'activa', capacity: 35, reserved: 19, attended: 12 });
const activities = [
  { activity_id: 'a1', title: 'Taller de Medicina', location: 'Laboratorio 2', sessions: [session('s1')], total_reserved: 19, total_attended: 12 },
  { activity_id: 'a2', title: 'Diseño sostenible', location: 'Edificio de Diseño', sessions: [session('s2'), session('s3')], total_reserved: 38, total_attended: 24 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mock.overview.mockResolvedValue(activities);
  mock.credential.mockResolvedValue({ activity_id: 'a2', title: 'Diseño sostenible', location: 'Edificio de Diseño', sessions: activities[1].sessions, qr_token: 'fake-token', manual_code: 'OV-4837' });
});

test('switches workshop operation details before opening its projection credential', async () => {
  render(<MemoryRouter><CheckinModule /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Taller de Medicina' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Diseño sostenible 2 horarios/ }));
  expect(screen.getByRole('heading', { name: 'Diseño sostenible' })).toBeInTheDocument();
  expect(screen.getByText('38')).toBeInTheDocument();
  expect(mock.credential).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Mostrar credencial' }));
  await waitFor(() => expect(mock.credential).toHaveBeenCalledWith('a2'));
  expect(await screen.findByText('OV-4837')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'QR de check-in' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pantalla completa' }));
  expect(screen.getByRole('dialog', { name: 'Credencial en pantalla completa' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Salir de pantalla completa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Volver a talleres' }));
  expect(screen.getByRole('heading', { name: 'Diseño sostenible' })).toBeInTheDocument();
});
