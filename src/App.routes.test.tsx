import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { useEdition } from './edition/EditionProvider';
import { useAuth, type StaffRole } from './lib/auth';

vi.mock('./lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/auth')>(), useAuth: vi.fn(),
}));
vi.mock('./edition/EditionProvider', () => ({ useEdition: vi.fn() }));
vi.mock('./theme/PublicThemeProvider', () => ({ PublicSurface: () => <Outlet />, usePublicTheme: vi.fn() }));
vi.mock('./admin/Overview', () => ({ default: () => <div>Inicio de Coordinación</div> }));
vi.mock('./admin/participants/Participants', () => ({ default: () => <div>Ruta participantes</div> }));
vi.mock('./admin/participants/ParticipantDetail', () => ({ default: () => <div>Ruta expediente</div> }));
vi.mock('./admin/imports/ParticipantImport', () => ({ default: () => <div>Ruta importar padrón</div> }));
vi.mock('./admin/export/ExportPage', () => ({ default: () => <div>Ruta exportar</div> }));
vi.mock('./admin/CheckinModule', () => ({ default: () => <div>Ruta check-in</div> }));
vi.mock('./admin/OperationsCenter', () => ({ default: () => <div>Ruta operación</div> }));
vi.mock('./admin/RaffleAdmin', () => ({ default: () => <div>Ruta sorteo final</div> }));
vi.mock('./admin/catalog/Catalog', () => ({ default: () => <div>Ruta catálogo</div> }));
vi.mock('./admin/catalog/CatalogImport', () => ({ default: () => <div>Ruta importar catálogo</div> }));
vi.mock('./admin/workshops/WorkshopInbox', () => ({ default: () => <div>Ruta talleres</div> }));
vi.mock('./admin/workshops/WorkshopDetail', () => ({ default: () => <div>Ruta detalle taller</div> }));
vi.mock('./admin/workshops/WorkshopProgram', () => ({ default: () => <div>Ruta programa</div> }));
vi.mock('./admin/staff/StaffAccounts', () => ({ default: () => <div>Ruta personal</div> }));
vi.mock('./admin/theme/ThemeEditor', () => ({ default: () => <div>Ruta experiencia pública</div> }));
vi.mock('./admin/ReservationRules', () => ({ default: () => <div>Ruta reservaciones</div> }));
vi.mock('./admin/Operation', () => ({ default: () => <div>Ruta preparación</div> }));
vi.mock('./admin/AuditLog', () => ({ default: () => <div>Ruta auditoría</div> }));
vi.mock('./admin/RaffleOperator', () => ({ default: () => <div>Ruta sorteo</div> }));

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null,
    staff: { user_id: 'staff-1', full_name: 'Persona', roles }, signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}
const show = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useEdition).mockReturnValue({ loading: false, reloadEdition: vi.fn(),
    edition: { name: 'Día OV 2026', mode: 'preparacion' } } as unknown as ReturnType<typeof useEdition>);
});

test.each([
  ['/coordinacion/participantes/123', 'Ruta expediente'],
  ['/coordinacion/participantes/importar', 'Ruta importar padrón'],
  ['/coordinacion/participantes/exportar', 'Ruta exportar'],
  ['/coordinacion/checkin', 'Ruta check-in'],
  ['/coordinacion/operacion-en-vivo', 'Ruta operación'],
  ['/coordinacion/sorteo-admin', 'Ruta sorteo final'],
  ['/coordinacion/talleres', 'Ruta talleres'],
  ['/coordinacion/talleres/123', 'Ruta detalle taller'],
  ['/coordinacion/talleres/programa', 'Ruta programa'],
  ['/coordinacion/talleres/programa/importar', 'Ruta importar catálogo'],
  ['/coordinacion/configuracion/personal', 'Ruta personal'],
  ['/coordinacion/configuracion/experiencia-publica', 'Ruta experiencia pública'],
  ['/coordinacion/configuracion/reservaciones', 'Ruta reservaciones'],
  ['/coordinacion/configuracion/preparacion', 'Ruta preparación'],
  ['/coordinacion/configuracion/catalogo', 'Ruta catálogo'],
  ['/coordinacion/configuracion/catalogo/importar', 'Ruta importar catálogo'],
  ['/coordinacion/configuracion/auditoria', 'Ruta auditoría'],
])('Coordinación opens %s', async (path, content) => {
  role(['coordinacion']);
  show(path);
  expect(await screen.findByText(content)).toBeInTheDocument();
});

test.each([
  ['/coordinacion/acceso', 'Ruta participantes'],
  ['/coordinacion/importar', 'Ruta importar padrón'],
  ['/coordinacion/conflictos', 'Ruta importar padrón'],
  ['/coordinacion/exportacion', 'Ruta exportar'],
  ['/coordinacion/personal', 'Ruta personal'],
  ['/coordinacion/tematica', 'Ruta experiencia pública'],
  ['/coordinacion/reservaciones', 'Ruta reservaciones'],
  ['/coordinacion/operacion', 'Ruta preparación'],
  ['/coordinacion/catalogo', 'Ruta catálogo'],
  ['/coordinacion/catalogo/importar', 'Ruta importar catálogo'],
  ['/coordinacion/auditoria', 'Ruta auditoría'],
])('retired deep link %s redirects to its new home', async (path, content) => {
  role(['coordinacion']);
  show(path);
  expect(await screen.findByText(content)).toBeInTheDocument();
});

test.each(['/coordinacion/mas', '/coordinacion/rangos'])('retired %s lands on the Configuración home', async (path) => {
  role(['coordinacion']);
  show(path);
  expect(await screen.findByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
  expect(screen.queryByText(/Reglas de rangos/)).not.toBeInTheDocument();
});

test('the old access-help link keeps working for staff, who land on Participantes', async () => {
  role(['staff']);
  show('/coordinacion/acceso');
  expect(await screen.findByText('Ruta participantes')).toBeInTheDocument();
});

test.each([
  '/coordinacion/participantes/importar', '/coordinacion/participantes/exportar', '/coordinacion/configuracion',
  '/coordinacion/configuracion/personal', '/coordinacion/talleres', '/coordinacion/sorteo-admin',
])('staff cannot open the coordination-only %s', async (path) => {
  role(['staff']);
  show(path);
  expect(await screen.findByText('Ruta participantes')).toBeInTheDocument();
});

test('staff can still use check-in and the operations center', async () => {
  role(['staff']);
  show('/coordinacion/checkin');
  expect(await screen.findByText('Ruta check-in')).toBeInTheDocument();
});

test('sorteo-only accounts still redirect from the root to their operator view', async () => {
  role(['sorteo']);
  show('/coordinacion');
  expect(await screen.findByText('Ruta sorteo')).toBeInTheDocument();
});
