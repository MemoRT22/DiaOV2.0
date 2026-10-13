import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import CheckinModule from './CheckinModule';
import { useAuth, type StaffRole } from '../lib/auth';

vi.mock('../lib/checkin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/checkin')>()),
  fetchCheckinOverview: vi.fn().mockResolvedValue([{ activity_id: 'a1', title: 'Taller', location: 'Aula', sessions: [], total_reserved: 0, total_attended: 0 }]),
}));
vi.mock('../lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/auth')>()), useAuth: vi.fn() }));
const as = (roles: StaffRole[]) => vi.mocked(useAuth).mockReturnValue({ staff: { user_id: 'u', full_name: 'Persona', roles } } as unknown as ReturnType<typeof useAuth>);

beforeEach(() => vi.clearAllMocks());

describe('acceso a la descarga de QR desde Check-in', () => {
  test('Coordinación ve «Descargar QR de talleres» y apunta a la pantalla dedicada', async () => {
    as(['coordinacion']);
    render(<MemoryRouter><CheckinModule /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: 'Descargar QR de talleres' });
    expect(link).toHaveAttribute('href', '/coordinacion/checkin/qr-talleres');
    expect(screen.getByRole('button', { name: 'Mostrar credencial' })).toBeInTheDocument(); // la credencial individual sigue ahí
  });
  test('el Staff operativo no la ve', async () => {
    as(['staff']);
    render(<MemoryRouter><CheckinModule /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Mostrar credencial' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Descargar QR de talleres' })).not.toBeInTheDocument();
  });
});
