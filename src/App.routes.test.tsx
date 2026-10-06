import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { useAuth, type StaffRole } from './lib/auth';
import { neutralTheme } from './theme/neutralTheme';
import { useTheme } from './theme/ThemeProvider';

vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(), useAuth: vi.fn(),
}));
vi.mock('./theme/ThemeProvider', () => ({ useTheme: vi.fn() }));
vi.mock('./admin/Overview', () => ({ default: () => <div>Inicio de Coordinación</div> }));
vi.mock('./admin/participants/Participants', () => ({ default: () => <div>Ruta participantes</div> }));
vi.mock('./admin/participants/ParticipantDetail', () => ({ default: () => <div>Ruta expediente</div> }));
vi.mock('./admin/participants/AccessHelp', () => ({ default: () => <div>Ruta acceso</div> }));
vi.mock('./admin/CheckinModule', () => ({ default: () => <div>Ruta check-in</div> }));
vi.mock('./admin/OperationsCenter', () => ({ default: () => <div>Ruta operación</div> }));
vi.mock('./admin/catalog/Catalog', () => ({ default: () => <div>Ruta catálogo</div> }));
vi.mock('./admin/catalog/CatalogImport', () => ({ default: () => <div>Ruta importar catálogo</div> }));
vi.mock('./admin/workshops/WorkshopInbox', () => ({ default: () => <div>Ruta talleres</div> }));
vi.mock('./admin/workshops/WorkshopDetail', () => ({ default: () => <div>Ruta detalle taller</div> }));
vi.mock('./admin/RaffleOperator', () => ({ default: () => <div>Ruta sorteo</div> }));

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null,
    staff: { user_id: 'staff-1', full_name: 'Persona', roles }, signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}
const show = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTheme).mockReturnValue({ theme: neutralTheme, loading: false,
    edition: { name: 'Día OV 2026', mode: 'preparacion' } } as ReturnType<typeof useTheme>);
});

test.each([
  ['/coordinacion/participantes/123', 'Ruta expediente'],
  ['/coordinacion/acceso', 'Ruta acceso'],
  ['/coordinacion/checkin', 'Ruta check-in'],
  ['/coordinacion/operacion-en-vivo', 'Ruta operación'],
  ['/coordinacion/catalogo/importar', 'Ruta importar catálogo'],
  ['/coordinacion/talleres/123', 'Ruta detalle taller'],
])('preserves direct access to %s', async (path, content) => {
  role(['coordinacion']);
  show(path);
  expect(await screen.findByText(content)).toBeInTheDocument();
});

test('staff cannot open the coordination-only More area', async () => {
  role(['staff']);
  show('/coordinacion/mas');
  expect(await screen.findByText('Ruta participantes')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Más herramientas' })).not.toBeInTheDocument();
});

test('Coordinación can open the new More area directly', async () => {
  role(['coordinacion']);
  show('/coordinacion/mas');
  expect(await screen.findByRole('heading', { name: 'Más herramientas' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Padrón oficial/ })).toHaveAttribute('href', '/coordinacion/importar');
});

test('sorteo-only accounts still redirect from the root to their operator view', async () => {
  role(['sorteo']);
  show('/coordinacion');
  expect(await screen.findByText('Ruta sorteo')).toBeInTheDocument();
});
