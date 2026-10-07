import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { lazy, Suspense, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { RECOVERY_KEY, resetRecoveryState } from '../lib/chunkRecovery';
import RouteErrorBoundary from './RouteErrorBoundary';
import { BootSpinner } from './BootSpinner';

const reload = vi.fn();

beforeEach(() => {
  reload.mockReset();
  resetRecoveryState();
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('location', { ...window.location, reload, pathname: '/coordinacion/participantes/importar' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Boom({ message = 'kaboom' }: { message?: string }): never {
  throw new Error(message);
}

test('an unexpected render error shows a human fallback, never an empty screen', () => {
  render(<RouteErrorBoundary><Boom /></RouteErrorBoundary>);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'No pudimos cargar esta pantalla' })).toBeInTheDocument();
  expect(screen.getByText('La aplicación pudo actualizarse mientras la estabas usando.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
});

test('the fallback leaks nothing technical', () => {
  window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: Date.now(), path: '/x' })); // already recovered once: no more reloads
  render(<RouteErrorBoundary><Boom message="Failed to fetch dynamically imported module: /assets/ParticipantImport-9f8a7b.js" /></RouteErrorBoundary>);
  expect(screen.getByRole('heading', { name: 'No pudimos cargar esta pantalla' })).toBeInTheDocument();
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/Failed to fetch|dynamically|\.js|assets\/|hash|stack|at \w+ \(/i);
});

test('«Recargar» reloads the current page', () => {
  render(<RouteErrorBoundary><Boom /></RouteErrorBoundary>);
  fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('the admin boundary sends «Volver al inicio» to the admin home', () => {
  render(<RouteErrorBoundary home="/coordinacion"><Boom /></RouteErrorBoundary>);
  expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/coordinacion');
});

test('navigating away from a broken screen clears the error', () => {
  function Host() {
    const [path, setPath] = useState('/roto');
    return (
      <>
        <button onClick={() => setPath('/sano')}>ir</button>
        <RouteErrorBoundary resetKey={path}>{path === '/roto' ? <Boom /> : <p>Pantalla sana</p>}</RouteErrorBoundary>
      </>
    );
  }
  render(<Host />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ir' }));
  expect(screen.getByText('Pantalla sana')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a normal data error handled by the screen is NOT a fatal route error', () => {
  function Screen() {
    const [error] = useState('No se pudo cargar la lista de participantes');
    return <p role="status">{error}</p>; // how useLoad-based screens report data failures: state, not a throw
  }
  render(<RouteErrorBoundary><Screen /></RouteErrorBoundary>);
  expect(screen.getByText('No se pudo cargar la lista de participantes')).toBeInTheDocument();
  expect(screen.queryByText('No pudimos cargar esta pantalla')).not.toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});

test('a business error object thrown inside an async handler never reaches the boundary', async () => {
  function Screen() {
    const [msg, setMsg] = useState('');
    return (
      <>
        <button onClick={() => Promise.reject(new Error('SCHEDULE_CONFLICT')).catch((e: Error) => setMsg(e.message))}>reservar</button>
        <p>{msg}</p>
      </>
    );
  }
  render(<RouteErrorBoundary><Screen /></RouteErrorBoundary>);
  fireEvent.click(screen.getByRole('button', { name: 'reservar' }));
  await waitFor(() => expect(screen.getByText('SCHEDULE_CONFLICT')).toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// ---- the deployment scenario, through React.lazy
const staleChunk = () => lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/ParticipantImport-OLD.js')));

function renderStale() {
  const Stale = staleChunk();
  return render(
    <MemoryRouter initialEntries={['/coordinacion/participantes/importar']}>
      <RouteErrorBoundary resetKey="/coordinacion/participantes/importar">
        <Suspense fallback={<p>Cargando</p>}><Stale /></Suspense>
      </RouteErrorBoundary>
    </MemoryRouter>,
  );
}

test('stale chunk, first time: ONE automatic reload on the same URL, with the loading state (no error flash)', async () => {
  renderStale();
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('heading', { name: 'No pudimos cargar esta pantalla' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument(); // Spinner («Cargando»), not a blank area
  expect(window.location.pathname).toBe('/coordinacion/participantes/importar');
});

test('stale chunk, right after the reload: no second reload; the human fallback appears', async () => {
  renderStale();
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  cleanupAndRestart();
  renderStale();
  expect(await screen.findByRole('heading', { name: 'No pudimos cargar esta pantalla' })).toBeInTheDocument();
  expect(reload).toHaveBeenCalledTimes(1);
});

function cleanupAndRestart() {
  document.body.innerHTML = '';
  resetRecoveryState(); // the real reload replaces the page; sessionStorage (the guard) survives it
}

test('while the chunk is simply loading, «Cargando» is visible and nothing is reloaded', () => {
  const Slow = lazy(() => new Promise<never>(() => {}));
  render(<RouteErrorBoundary><Suspense fallback={<BootSpinner />}><Slow /></Suspense></RouteErrorBoundary>);
  expect(screen.getByText('Cargando')).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});

test('a load that never answers eventually offers a way out instead of an eternal «Cargando»', () => {
  vi.useFakeTimers();
  try {
    render(<BootSpinner after={5_000} />);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5_001); });
    expect(screen.getByText(/Está tardando más de lo normal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
