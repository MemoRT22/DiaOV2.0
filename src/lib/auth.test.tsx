import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider, navigation, useAuth } from './auth';
import { authStorageKey } from './localSession';

const m = vi.hoisted(() => ({ listener: null as null | ((event: string, session: unknown) => void), identityLoads: 0, who: 'staff' as 'staff' | 'alumno', fail: false }));

vi.mock('./supabase', () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => {
      if (m.fail) return { data: null, error: { message: 'timeout' } };
      if (table === 'staff_members') m.identityLoads += 1;
      if (table === 'participant_profiles' && m.who === 'alumno') return { data: { participant_id: 'p1', display_name: 'Ana', high_school: null, platform_consent_at: null, platform_consent_version: null }, error: null };
      return { data: table === 'staff_members' && m.who === 'staff' ? { user_id: 'u1', full_name: 'Operador', is_active: true, staff_roles: [{ role: 'coordinacion' }] } : null, error: null };
    };
    return chain;
  };
  return { supabaseUrl: 'https://abc.supabase.co', supabase: {
    from: query,
    auth: { onAuthStateChange: (callback: (event: string, session: unknown) => void) => { m.listener = callback; return { data: { subscription: { unsubscribe: () => undefined } } }; }, signOut: async () => undefined, stopAutoRefresh: () => undefined },
  } };
});

const session = (id: string) => ({ access_token: 't', user: { id } });
function Probe() {
  const { ready, staff } = useAuth();
  return <p>{ready ? `listo:${staff?.full_name ?? 'sin cuenta'}` : 'cargando'}</p>;
}
const emit = (event: string, value: unknown) => act(async () => { m.listener?.(event, value); });

beforeEach(() => { m.identityLoads = 0; m.listener = null; m.who = 'staff'; m.fail = false; });

test('the same account signing in again (tab regains focus, another window opens) does not reset the identity', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  expect(await screen.findByText('listo:Operador')).toBeInTheDocument();
  expect(m.identityLoads).toBe(1);
  await emit('SIGNED_IN', session('u1'));
  expect(screen.getByText('listo:Operador')).toBeInTheDocument(); // never went back to «cargando»
  expect(m.identityLoads).toBe(1);
});

test('a different account, and signing out, do reload the identity', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  await screen.findByText('listo:Operador');
  await emit('SIGNED_IN', session('u2'));
  expect(m.identityLoads).toBe(2);
  await emit('SIGNED_OUT', null);
  expect(await screen.findByText('listo:sin cuenta')).toBeInTheDocument();
  await emit('SIGNED_IN', session('u2'));
  expect(m.identityLoads).toBe(3); // after signing out the same account is a new sign-in
});

const KEY = authStorageKey('https://abc.supabase.co');
function Out() { const { signOut, signOutError, staff, profile } = useAuth(); return <><button onClick={() => void signOut()}>salir</button><p>{signOutError ?? 'sin error'}</p><p>{staff ? 'personal' : profile ? 'alumno' : 'anónimo'}</p></>; }
const press = async () => { await act(async () => { screen.getByText('salir').click(); }); };
async function failingServer(error: unknown = new Error('network')) {
  const { supabase } = await import('./supabase');
  return vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error } as never);
}
beforeEach(() => { localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

test('normal sign-out: the server answers, nothing else is touched and the app is not restarted', async () => {
  const { supabase } = await import('./supabase');
  vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as never);
  const restart = vi.spyOn(navigation, 'restart').mockImplementation(() => undefined);
  localStorage.setItem(KEY, '{"access_token":"t"}');
  render(<AuthProvider><Out /></AuthProvider>);
  await press();
  expect(restart).not.toHaveBeenCalled();
  expect(localStorage.getItem(KEY)).not.toBeNull(); // removing it after a successful logout is supabase-js's job, as before
  expect(screen.getByText('sin error')).toBeInTheDocument();
});

test.each([['network failure', new Error('network')], ['timeout', Object.assign(new Error('aborted'), { name: 'AbortError' })]])('recovery (%s): only THIS project\'s session is removed, then the app restarts', async (_name, error) => {
  await failingServer(error);
  const restart = vi.spyOn(navigation, 'restart').mockImplementation(() => undefined);
  localStorage.setItem(KEY, '{"access_token":"t"}');
  localStorage.setItem(`${KEY}-code-verifier`, 'v');
  localStorage.setItem('sb-otherproject-auth-token', '{"access_token":"other"}');
  localStorage.setItem('unrelated', 'keep');
  render(<AuthProvider><Out /></AuthProvider>);
  await press();
  expect(localStorage.getItem(KEY)).toBeNull();
  expect(localStorage.getItem(`${KEY}-code-verifier`)).toBeNull();
  expect(localStorage.getItem('sb-otherproject-auth-token')).not.toBeNull();
  expect(localStorage.getItem('unrelated')).toBe('keep');
  expect(restart).toHaveBeenCalledTimes(1);
});

test.each([['alumno'], ['personal']])('recovery as %s: after the restart the identity is anonymous and the old session does not come back', async (who) => {
  m.who = who === 'alumno' ? 'alumno' : 'staff';
  await failingServer();
  const restart = vi.spyOn(navigation, 'restart').mockImplementation(() => undefined);
  localStorage.setItem(KEY, JSON.stringify({ access_token: 't', user: { id: 'u1' } }));
  const first = render(<AuthProvider><Out /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  await screen.findByText(who === 'personal' ? 'personal' : 'alumno');
  await press();
  expect(restart).toHaveBeenCalled();
  first.unmount();
  // «reload»: a new app reads the storage; nothing is left to restore
  render(<AuthProvider><Out /></AuthProvider>);
  await emit('INITIAL_SESSION', localStorage.getItem(KEY) ? session('u1') : null);
  expect(await screen.findByText('anónimo')).toBeInTheDocument();
});

test('if the stored session cannot be proven gone, nothing is restarted and the person is told', async () => {
  await failingServer();
  const restart = vi.spyOn(navigation, 'restart').mockImplementation(() => undefined);
  vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  localStorage.setItem(KEY, '{"access_token":"t"}');
  render(<AuthProvider><Out /></AuthProvider>);
  await press();
  expect(restart).not.toHaveBeenCalled();
  expect(screen.getByText(/No pudimos cerrar tu sesión en este dispositivo/)).toBeInTheDocument();
});

test('if the key is still there after removing it, the same happens (no false success)', async () => {
  await failingServer();
  const restart = vi.spyOn(navigation, 'restart').mockImplementation(() => undefined);
  vi.spyOn(localStorage, 'removeItem').mockImplementation(() => undefined); // silently does nothing
  localStorage.setItem(KEY, '{"access_token":"t"}');
  render(<AuthProvider><Out /></AuthProvider>);
  await press();
  expect(restart).not.toHaveBeenCalled();
  expect(screen.getByText(/No pudimos cerrar tu sesión/)).toBeInTheDocument();
});

function Who() { const { ready, profile, staff, identityFailed } = useAuth(); return <p>{!ready ? 'cargando' : identityFailed ? 'fallo' : profile ? `alumno:${profile.display_name}` : staff ? 'personal' : 'anónimo'}</p>; }
const profile = { participant_id: 'p1', display_name: 'Ana', high_school: null, platform_consent_at: null, platform_consent_version: 'v1' };

test('a verified identity is remembered per account, and a failing server never turns it into «no account»', async () => {
  m.who = 'alumno';
  const { unmount } = render(<AuthProvider><Who /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  expect(await screen.findByText('alumno:Ana')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('diaov-identity:u1') ?? 'null').profile.display_name).toBe('Ana');
  unmount();
  // the app is opened again while the server fails: the student is still in, not sent to the login screen
  m.fail = true;
  render(<AuthProvider><Who /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  expect(await screen.findByText('alumno:Ana')).toBeInTheDocument();
});

test('another account never inherits a remembered identity', async () => {
  localStorage.setItem('diaov-identity:u1', JSON.stringify({ profile, staff: null }));
  m.fail = true;
  vi.useFakeTimers();
  render(<AuthProvider><Who /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u2'));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  vi.useRealTimers();
  expect(screen.getByText('fallo')).toBeInTheDocument();
});

test('with a session but no way to load the profile: retries, then reports the failure (not an anonymous visitor)', async () => {
  m.fail = true;
  vi.useFakeTimers();
  render(<AuthProvider><Who /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  expect(screen.getByText('cargando')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  vi.useRealTimers();
  expect(screen.getByText('fallo')).toBeInTheDocument();
});

test('a real sign-out clears the remembered identities; a server that answers «no profile» is believed', async () => {
  localStorage.setItem('diaov-identity:u1', JSON.stringify({ profile, staff: null }));
  m.who = 'alumno';
  render(<AuthProvider><Who /></AuthProvider>);
  await emit('INITIAL_SESSION', session('u1'));
  await screen.findByText('alumno:Ana');
  await emit('SIGNED_OUT', null);
  expect(await screen.findByText('anónimo')).toBeInTheDocument();
  expect(localStorage.getItem('diaov-identity:u1')).toBeNull();
});
