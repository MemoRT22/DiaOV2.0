import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAuth, type StaffRole } from '../lib/auth';
import { neutralTheme } from '../theme/neutralTheme';
import { useTheme } from '../theme/ThemeProvider';
import AdminLayout from './AdminLayout';
import MoreTools from './MoreTools';

vi.mock('../lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/auth')>(), useAuth: vi.fn(),
}));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: vi.fn() }));

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, staff: {
    user_id: 'staff-1', full_name: 'Coordinadora', roles,
  }, signOut: vi.fn() } as unknown as ReturnType<typeof useAuth>);
}
function show(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/coordinacion" element={<AdminLayout />}>
      <Route index element={<div>Inicio abierto</div>} />
      <Route path="mas" element={<MoreTools />} />
      <Route path="participantes" element={<div>Participantes abiertos</div>} />
      <Route path="catalogo/importar" element={<div>Importador abierto</div>} />
      <Route path="sorteo" element={<div>Sorteo abierto</div>} />
    </Route>
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTheme).mockReturnValue({ theme: neutralTheme, loading: false,
    edition: { name: 'Día OV 2026', mode: 'preparacion' } } as ReturnType<typeof useTheme>);
});

test('Coordinación sees five clear destinations in the sidebar', () => {
  role(['coordinacion']);
  show('/coordinacion');
  const nav = screen.getByRole('navigation', { name: 'Navegación de Coordinación' });
  const links = within(nav).getAllByRole('link');
  expect(links).toHaveLength(5);
  expect(links.map((link) => link.textContent)).toEqual([
    'Inicio', 'Participantes', 'Talleres', 'Operación del evento', 'Más herramientas',
  ]);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/coordinacion', '/coordinacion/participantes', '/coordinacion/talleres',
    '/coordinacion/operacion-en-vivo', '/coordinacion/mas',
  ]);
  expect(within(nav).queryByRole('link', { name: 'Padrón oficial' })).not.toBeInTheDocument();
});

test('all advanced tools remain reachable in More', async () => {
  role(['coordinacion']);
  show('/coordinacion');
  fireEvent.click(screen.getByRole('link', { name: 'Más herramientas' }));
  expect(await screen.findByRole('heading', { name: 'Más herramientas' })).toBeInTheDocument();
  const expected = [
    ['Ayuda de acceso', '/coordinacion/acceso'], ['Padrón oficial', '/coordinacion/importar'],
    ['Conflictos de importación', '/coordinacion/conflictos'], ['Exportación', '/coordinacion/exportacion'],
    ['Catálogo', '/coordinacion/catalogo'], ['Check-in', '/coordinacion/checkin'],
    ['Reservaciones', '/coordinacion/reservaciones'], ['Sorteo final', '/coordinacion/sorteo-admin'],
    ['Personal', '/coordinacion/personal'], ['Edición y temática', '/coordinacion/tematica'],
    ['Reglas de rangos', '/coordinacion/rangos'], ['Preparación y puesta en marcha', '/coordinacion/operacion'],
    ['Auditoría', '/coordinacion/auditoria'], ['Mi cuenta', '/coordinacion/cuenta'],
  ];
  for (const [label, href] of expected) {
    expect(screen.getByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', href);
  }
});

test('old deep links open and keep More visibly selected', () => {
  role(['coordinacion']);
  show('/coordinacion/catalogo/importar');
  expect(screen.getByText('Importador abierto')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Más herramientas' })).toHaveClass('bg-primary-500/10');
});

test('staff keeps its permitted navigation without coordination tools', () => {
  role(['staff']);
  show('/coordinacion/participantes');
  const nav = screen.getByRole('navigation', { name: 'Navegación de staff' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
    'Participantes', 'Ayuda de acceso', 'Check-in', 'Centro de Operación', 'Mi cuenta',
  ]);
  expect(within(nav).queryByRole('link', { name: 'Talleres' })).not.toBeInTheDocument();
  expect(within(nav).queryByRole('link', { name: 'Más herramientas' })).not.toBeInTheDocument();
});

test('sorteo-only staff keeps its specific two-link experience', () => {
  role(['sorteo']);
  show('/coordinacion/sorteo');
  expect(screen.getByText('Sorteo abierto')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sorteo final' })).toHaveAttribute('href', '/coordinacion/sorteo');
  expect(screen.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute('href', '/coordinacion/cuenta');
  expect(screen.queryByRole('link', { name: 'Talleres' })).not.toBeInTheDocument();
});
