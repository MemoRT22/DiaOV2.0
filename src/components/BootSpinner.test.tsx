import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AdminLayout from '../admin/AdminLayout';
import { useEdition } from '../edition/EditionProvider';
import { useAuth } from '../lib/auth';
import StudentLayout from '../student/StudentLayout';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { BootSpinner, SLOW_LOAD_MS } from './BootSpinner';

vi.mock('../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/auth')>(), useAuth: vi.fn() }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: vi.fn() }));
vi.mock('../theme/PublicThemeProvider', () => ({ usePublicTheme: vi.fn() }));
vi.mock('./themed', () => ({ Backdrop: () => null }));
vi.mock('../student/BottomNav', () => ({ default: () => <nav aria-label="Navegación inferior" /> }));

// This Node/jsdom combination exposes no usable localStorage: a minimal one whose keys are enumerable, like the real one.
function fakeLocalStorage() {
  const store: Record<string, string> = {};
  const api = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  for (const [name, fn] of Object.entries(api)) Object.defineProperty(store, name, { value: fn, enumerable: false });
  return store as unknown as Storage;
}

const assign = vi.fn();
const reload = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  assign.mockReset();
  reload.mockReset();
  vi.stubGlobal('location', { ...window.location, assign, reload });
  vi.stubGlobal('localStorage', fakeLocalStorage());
  window.localStorage.setItem('sb-proj-auth-token', 'session');
  window.localStorage.setItem('other', 'keep');
  vi.mocked(useAuth).mockReturnValue({
    ready: true, signOut: vi.fn(),
    profile: { display_name: 'Ana Pérez', platform_consent_version: 'v1' },
    staff: { user_id: 's', full_name: 'Coordinadora', roles: ['coordinacion'] },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useEdition).mockReturnValue({ loading: false, reloadEdition: vi.fn(),
    edition: { name: 'Día OV 2026', mode: 'preparacion', privacy_notice_version: 'v1' } } as unknown as ReturnType<typeof useEdition>);
  vi.mocked(usePublicTheme).mockReturnValue({ loading: false, text: () => 'x',
    theme: { assets: {}, meta: { eventName: 'Día OV' } } } as unknown as ReturnType<typeof usePublicTheme>);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const passThreshold = () => act(() => { vi.advanceTimersByTime(SLOW_LOAD_MS + 1); });
const neverLoads = () => lazy(() => new Promise<never>(() => {}));

test('student: «Empezar de nuevo» clears the stored session and goes to «/»', () => {
  render(<BootSpinner />);
  passThreshold();
  fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
  expect(window.localStorage.getItem('sb-proj-auth-token')).toBeNull();
  expect(window.localStorage.getItem('other')).toBe('keep');
  expect(assign).toHaveBeenCalledWith('/');
});

test('admin: «Empezar de nuevo» clears the stored session and goes to «/coordinacion», not to the student login', () => {
  render(<BootSpinner restartTo="/coordinacion" />);
  passThreshold();
  fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
  expect(window.localStorage.getItem('sb-proj-auth-token')).toBeNull();
  expect(assign).toHaveBeenCalledWith('/coordinacion');
  expect(assign).not.toHaveBeenCalledWith('/');
});

test('StudentLayout: a screen that stays pending offers recovery after the threshold, keeping header and navigation', () => {
  const Pending = neverLoads();
  render(<MemoryRouter initialEntries={['/misiones']}><Routes><Route element={<StudentLayout />}><Route path="/misiones" element={<Pending />} /></Route></Routes></MemoryRouter>);
  expect(screen.getByText('Cargando')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  passThreshold();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Navegación inferior' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
  expect(assign).toHaveBeenCalledWith('/');
});

test('AdminLayout: a screen that stays pending offers recovery after the threshold, keeping the sidebar, and restarts in Coordinación', () => {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: null, signOut: vi.fn(),
    staff: { user_id: 's', full_name: 'Coordinadora', roles: ['coordinacion'] } } as unknown as ReturnType<typeof useAuth>);
  const Pending = neverLoads();
  render(<MemoryRouter initialEntries={['/coordinacion/participantes']}><Routes><Route path="/coordinacion" element={<AdminLayout />}><Route path="participantes" element={<Pending />} /></Route></Routes></MemoryRouter>);
  expect(screen.getByText('Cargando')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  passThreshold();
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Navegación de Coordinación' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Empezar de nuevo' }));
  expect(assign).toHaveBeenCalledWith('/coordinacion');
});

test('a screen that loads before the threshold behaves as before: no recovery prompt, ever', async () => {
  const Quick = lazy(() => Promise.resolve({ default: () => <h1>Pantalla lista</h1> }));
  render(<MemoryRouter initialEntries={['/misiones']}><Routes><Route element={<StudentLayout />}><Route path="/misiones" element={<Quick />} /></Route></Routes></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByRole('heading', { name: 'Pantalla lista' })).toBeInTheDocument();
  passThreshold();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Está tardando/)).not.toBeInTheDocument();
});
