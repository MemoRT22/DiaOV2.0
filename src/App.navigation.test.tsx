import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { Link, MemoryRouter, Outlet, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { SETTINGS_SECTIONS } from './admin/navigation';
import { useEdition } from './edition/EditionProvider';
import { installChunkRecovery, resetRecoveryState } from './lib/chunkRecovery';
import { useAuth } from './lib/auth';

/**
 * Client-side navigation (clicking, not typing URLs) across the admin routes. The stand-in screens use the SAME relative
 * links as the real ones (`to="importar"`, `to=".." relative="path"`), so this proves how they resolve in the real route tree,
 * including the hop between a direct child of AdminLayout and the branches nested under <CoordinationOnly />.
 */
vi.mock('./lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('./lib/auth')>(), useAuth: vi.fn() }));
vi.mock('./edition/EditionProvider', () => ({ useEdition: vi.fn() }));
vi.mock('./theme/PublicThemeProvider', () => ({ PublicSurface: () => <Outlet />, usePublicTheme: vi.fn() }));

const Back = ({ label }: { label: string }) => <Link to=".." relative="path">{`← ${label}`}</Link>;

vi.mock('./admin/participants/Participants', () => ({ default: () => (
  <div><h1>Participantes</h1><Link to="importar">Importar padrón</Link><Link to="exportar">Exportar</Link></div>
) }));
vi.mock('./admin/imports/ParticipantImport', () => ({ default: () => <div><h1>Pantalla importar padrón</h1><Back label="Participantes" /></div> }));
vi.mock('./admin/export/ExportPage', () => ({ default: () => <div><h1>Pantalla exportar</h1><Back label="Participantes" /></div> }));
vi.mock('./admin/workshops/WorkshopInbox', () => ({ default: () => <h1>Pantalla propuestas</h1> }));
vi.mock('./admin/workshops/WorkshopProgram', () => ({ default: () => <div><h1>Pantalla programa</h1><Link to="importar">Importar programa</Link></div> }));
vi.mock('./admin/catalog/CatalogImport', () => ({ default: ({ backLabel }: { backLabel?: string }) => (
  <div><h1>Pantalla importar catálogo</h1><Back label={backLabel ?? 'Carreras y divisiones'} /></div>
) }));
vi.mock('./admin/catalog/Catalog', () => ({ default: () => <div><h1>Pantalla catálogo</h1><Link to="importar">Importar catálogo</Link></div> }));
vi.mock('./admin/OperationsCenter', () => ({ default: () => <h1>Pantalla centro</h1> }));
vi.mock('./admin/CheckinModule', () => ({ default: () => <h1>Pantalla check-in</h1> }));
vi.mock('./admin/RaffleAdmin', () => ({ default: () => <h1>Pantalla sorteo final</h1> }));
vi.mock('./admin/staff/StaffAccounts', () => ({ default: () => <h1>Pantalla personal</h1> }));
vi.mock('./admin/theme/ThemeEditor', () => ({ default: () => <h1>Pantalla experiencia pública</h1> }));
vi.mock('./admin/ReservationRules', () => ({ default: () => <h1>Pantalla reservaciones</h1> }));
vi.mock('./admin/Operation', () => ({ default: () => <h1>Pantalla preparación</h1> }));
vi.mock('./admin/AuditLog', () => ({ default: () => <h1>Pantalla auditoría</h1> }));

let go: (delta: number) => void = () => {};
function History() {
  const navigate = useNavigate();
  go = (delta) => navigate(delta);
  return null;
}
const back = () => act(() => go(-1));
const forward = () => act(() => go(1));

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><History /><App /></MemoryRouter>);
}
const sidebar = () => within(screen.getByRole('navigation', { name: 'Navegación de Coordinación' }));
const heading = (name: string) => screen.findByRole('heading', { name });

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, signOut: vi.fn(),
    staff: { user_id: 's', full_name: 'Coordinadora', roles: ['coordinacion'] } } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useEdition).mockReturnValue({ loading: false, reloadEdition: vi.fn(),
    edition: { name: 'Día OV 2026', mode: 'preparacion' } } as unknown as ReturnType<typeof useEdition>);
});

test('Participantes → Importar padrón → back link → Exportar → back link, never an empty content area', async () => {
  open('/coordinacion/participantes');
  fireEvent.click(await screen.findByRole('link', { name: 'Importar padrón' }));
  expect(await heading('Pantalla importar padrón')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '← Participantes' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Exportar' }));
  expect(await heading('Pantalla exportar')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '← Participantes' }));
  expect(await heading('Participantes')).toBeInTheDocument();
});

test('the sidebar also leads back out of the coordination-only branch', async () => {
  open('/coordinacion/participantes');
  fireEvent.click(await screen.findByRole('link', { name: 'Importar padrón' }));
  await heading('Pantalla importar padrón');
  fireEvent.click(sidebar().getByRole('link', { name: 'Participantes' }));
  expect(await heading('Participantes')).toBeInTheDocument();
});

test('Talleres → Programa → Importar programa → back link → Programa; browser back/forward walk the same history', async () => {
  open('/coordinacion/talleres');
  await heading('Pantalla propuestas');
  fireEvent.click(screen.getByRole('link', { name: 'Programa' }));
  await heading('Pantalla programa');
  fireEvent.click(screen.getByRole('link', { name: 'Importar programa' }));
  await heading('Pantalla importar catálogo');
  fireEvent.click(screen.getByRole('link', { name: '← Programa de talleres' }));
  expect(await heading('Pantalla programa')).toBeInTheDocument();

  back(); // → importar programa
  expect(await heading('Pantalla importar catálogo')).toBeInTheDocument();
  back(); // → programa
  expect(await heading('Pantalla programa')).toBeInTheDocument();
  back(); // → propuestas
  expect(await heading('Pantalla propuestas')).toBeInTheDocument();
  forward();
  expect(await heading('Pantalla programa')).toBeInTheDocument();
});

test('Operación → Check-in → Sorteo final through the area tabs', async () => {
  open('/coordinacion/operacion-en-vivo');
  await heading('Pantalla centro');
  const tabs = within(screen.getByRole('navigation', { name: 'Operación' }));
  fireEvent.click(tabs.getByRole('link', { name: 'Check-in' }));
  expect(await heading('Pantalla check-in')).toBeInTheDocument();
  fireEvent.click(tabs.getByRole('link', { name: 'Sorteo final' }));
  expect(await heading('Pantalla sorteo final')).toBeInTheDocument();
  back();
  expect(await heading('Pantalla check-in')).toBeInTheDocument();
});

test.each(SETTINGS_SECTIONS.map((s) => [s.label, s.to] as const))('Configuración → «%s» opens and the home is one click away', async (label) => {
  open('/coordinacion/configuracion');
  await heading('Configuración');
  fireEvent.click(await screen.findByRole('link', { name: new RegExp(`^${label}`) }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configuración' })).not.toBeInTheDocument());
  expect(await screen.findByRole('heading', { level: 1, name: /^Pantalla / })).toBeInTheDocument();
  back();
  expect(await heading('Configuración')).toBeInTheDocument();
});

test('Configuración → Catálogo → Importar catálogo → back link lands on the catalogue', async () => {
  open('/coordinacion/configuracion/catalogo');
  fireEvent.click(await screen.findByRole('link', { name: 'Importar catálogo' }));
  await heading('Pantalla importar catálogo');
  fireEvent.click(screen.getByRole('link', { name: '← Carreras y divisiones' }));
  expect(await heading('Pantalla catálogo')).toBeInTheDocument();
});

// ---- the deployment scenario, end to end in the route tree
test('after a deploy, navigating to a lazy route whose chunk is gone reloads once on that URL and then shows the human fallback', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload, pathname: '/coordinacion/participantes/importar' });
  window.sessionStorage.clear();
  resetRecoveryState();
  const remove = installChunkRecovery();
  const oldBuildChunk = () => lazy(() => {
    // what Vite's preload helper does when the (404 → index.html) chunk cannot be imported
    const failure = new Error('Failed to fetch dynamically imported module');
    const event = new Event('vite:preloadError', { cancelable: true });
    (event as Event & { payload: unknown }).payload = failure;
    window.dispatchEvent(event);
    return event.defaultPrevented ? Promise.resolve(undefined as never) : Promise.reject(failure);
  });
  const view = (Stale: ReturnType<typeof oldBuildChunk>) => render(
    <MemoryRouter initialEntries={['/coordinacion/participantes/importar']}>
      <RouteErrorBoundary><Suspense fallback={<p>Cargando</p>}><Stale /></Suspense></RouteErrorBoundary>
    </MemoryRouter>,
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const first = view(oldBuildChunk());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'No pudimos cargar esta pantalla' })).not.toBeInTheDocument(); // no flash while reloading
    expect(window.location.pathname).toBe('/coordinacion/participantes/importar'); // URL preserved
    first.unmount();

    resetRecoveryState(); // the reload replaced the page and the (still unreachable) chunk fails again; sessionStorage survived
    view(oldBuildChunk());
    expect(await screen.findByRole('heading', { name: 'No pudimos cargar esta pantalla' })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1); // no loop
  } finally {
    remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

afterEach(() => vi.clearAllMocks());
