import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useEdition } from '../edition/EditionProvider';
import { useAuth, type StaffRole } from '../lib/auth';
import AdminLayout from './AdminLayout';
import AreaLayout from './AreaLayout';
import { OPERATION_TABS, SETTINGS_BASE, SETTINGS_TABS } from './navigation';
import SettingsHome from './SettingsHome';

vi.mock('../lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/auth')>(), useAuth: vi.fn(),
}));
vi.mock('../edition/EditionProvider', () => ({ useEdition: vi.fn() }));

function role(roles: StaffRole[]) {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, staff: {
    user_id: 'staff-1', full_name: 'Coordinadora', roles,
  }, signOut: vi.fn() } as unknown as ReturnType<typeof useAuth>);
}
// Note: no PublicThemeProvider is rendered or mocked. The admin shell must not need the public theme at all.
function show(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/coordinacion" element={<AdminLayout />}>
      <Route index element={<div>Inicio abierto</div>} />
      <Route path="participantes" element={<div>Participantes abiertos</div>} />
      <Route path="cuenta" element={<div>Cuenta abierta</div>} />
      <Route path="sorteo" element={<div>Sorteo abierto</div>} />
      <Route element={<AreaLayout label="Operación" tabs={OPERATION_TABS} />}>
        <Route path="operacion-en-vivo" element={<div>Centro abierto</div>} />
        <Route path="checkin" element={<div>Check-in abierto</div>} />
        <Route path="sorteo-admin" element={<div>Sorteo final abierto</div>} />
      </Route>
      <Route path="configuracion" element={<AreaLayout label="Configuración" tabs={SETTINGS_TABS} hideAt={SETTINGS_BASE} />}>
        <Route index element={<SettingsHome />} />
        <Route path="personal" element={<div>Personal abierto</div>} />
      </Route>
    </Route>
  </Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useEdition).mockReturnValue({ loading: false, reloadEdition: vi.fn(),
    edition: { name: 'Día OV 2026', mode: 'preparacion' } } as unknown as ReturnType<typeof useEdition>);
});

test('Coordinación sees the five product areas and nothing else in the sidebar', () => {
  role(['coordinacion']);
  show('/coordinacion');
  const nav = screen.getByRole('navigation', { name: 'Navegación de Coordinación' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual(['Inicio', 'Participantes', 'Talleres', 'Operación', 'Configuración']);
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/coordinacion', '/coordinacion/participantes', '/coordinacion/talleres',
    '/coordinacion/operacion-en-vivo', '/coordinacion/configuracion',
  ]);
  for (const retired of ['Ayuda de acceso', 'Conflictos de importación', 'Reglas de rangos', 'Padrón oficial', 'Más herramientas']) {
    expect(screen.queryByRole('link', { name: retired })).not.toBeInTheDocument();
  }
});

test('Mi cuenta belongs to the profile, not to the product areas', () => {
  role(['coordinacion']);
  show('/coordinacion');
  const nav = screen.getByRole('navigation', { name: 'Navegación de Coordinación' });
  expect(within(nav).queryByRole('link', { name: /Mi cuenta/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Mi cuenta · Coordinadora/ })).toHaveAttribute('href', '/coordinacion/cuenta');
  expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
});

test('Operación groups the live center, check-in and the final raffle', () => {
  role(['coordinacion']);
  show('/coordinacion/checkin');
  const tabs = screen.getByRole('navigation', { name: 'Operación' });
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Centro de Operación', 'Check-in', 'Sorteo final']);
  expect(within(tabs).getByRole('link', { name: 'Check-in' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Check-in abierto')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Navegación de Coordinación' })
    .querySelector('a[href="/coordinacion/operacion-en-vivo"]')).toHaveClass('bg-primary-500/10');
});

test('Configuración home lists every section and sections keep a tab bar', () => {
  role(['coordinacion']);
  const { unmount } = show('/coordinacion/configuracion');
  expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument();
  for (const label of ['Personal', 'Experiencia pública', 'Reservaciones', 'Preparación y puesta en marcha', 'Catálogos académicos', 'Auditoría']) {
    expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
  }
  expect(screen.queryByRole('navigation', { name: 'Configuración' })).not.toBeInTheDocument();
  unmount();
  show('/coordinacion/configuracion/personal');
  expect(within(screen.getByRole('navigation', { name: 'Configuración' })).getAllByRole('link')).toHaveLength(6);
  expect(screen.getByText('Personal abierto')).toBeInTheDocument();
});

test('staff keeps a short navigation without coordination tools', () => {
  role(['staff']);
  show('/coordinacion/participantes');
  const nav = screen.getByRole('navigation', { name: 'Navegación de staff' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Participantes', 'Operación']);
  for (const hidden of ['Talleres', 'Configuración', 'Ayuda de acceso']) {
    expect(within(nav).queryByRole('link', { name: hidden })).not.toBeInTheDocument();
  }
});

test('staff sees check-in but not the coordination-only raffle tab', () => {
  role(['staff']);
  show('/coordinacion/checkin');
  const tabs = screen.getByRole('navigation', { name: 'Operación' });
  expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Centro de Operación', 'Check-in']);
});

test('sorteo-only staff keeps its specific experience', () => {
  role(['sorteo']);
  show('/coordinacion/sorteo');
  expect(screen.getByText('Sorteo abierto')).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Navegación de sorteo' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Sorteo final']);
  expect(screen.getByRole('link', { name: /Mi cuenta/ })).toHaveAttribute('href', '/coordinacion/cuenta');
});

test('uses the fixed admin identity even if the edition has a name', () => {
  role(['coordinacion']);
  show('/coordinacion');
  expect(screen.getByText('Día OV 2026')).toBeInTheDocument();
  expect(screen.getByText('Preparación')).toBeInTheDocument();
  expect(document.querySelector('aside img')).toHaveAttribute('src', '/assets/images/Logo_A.png');
});
