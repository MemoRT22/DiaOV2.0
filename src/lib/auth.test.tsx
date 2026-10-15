import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';

const m = vi.hoisted(() => ({ listener: null as null | ((event: string, session: unknown) => void), identityLoads: 0 }));

vi.mock('./supabase', () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => {
      if (table === 'staff_members') m.identityLoads += 1;
      return { data: table === 'staff_members' ? { user_id: 'u1', full_name: 'Operador', is_active: true, staff_roles: [{ role: 'coordinacion' }] } : null, error: null };
    };
    return chain;
  };
  return { supabase: {
    from: query,
    auth: { onAuthStateChange: (callback: (event: string, session: unknown) => void) => { m.listener = callback; return { data: { subscription: { unsubscribe: () => undefined } } }; }, signOut: async () => undefined },
  } };
});

const session = (id: string) => ({ access_token: 't', user: { id } });
function Probe() {
  const { ready, staff } = useAuth();
  return <p>{ready ? `listo:${staff?.full_name ?? 'sin cuenta'}` : 'cargando'}</p>;
}
const emit = (event: string, value: unknown) => act(async () => { m.listener?.(event, value); });

beforeEach(() => { m.identityLoads = 0; m.listener = null; });

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

test('signing out always leaves this device: if the server logout fails, the stored session is removed and the app restarts at the start', async () => {
  const { supabase } = await import('./supabase');
  vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: new Error('network') } as never);
  const assign = vi.fn();
  const realLocation = window.location;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
  localStorage.setItem('sb-abc-auth-token', '{"access_token":"t"}');
  localStorage.setItem('other-key', 'keep');
  function Out() { const { signOut } = useAuth(); return <button onClick={() => void signOut()}>salir</button>; }
  render(<AuthProvider><Out /></AuthProvider>);
  await act(async () => { screen.getByText('salir').click(); });
  expect(localStorage.getItem('sb-abc-auth-token')).toBeNull();
  expect(localStorage.getItem('other-key')).toBe('keep');
  expect(assign).toHaveBeenCalledWith('/');
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

test('a server logout that works needs no restart', async () => {
  const { supabase } = await import('./supabase');
  vi.spyOn(supabase.auth, 'signOut').mockResolvedValueOnce({ error: null } as never);
  const assign = vi.fn();
  const realLocation = window.location;
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
  function Out() { const { signOut } = useAuth(); return <button onClick={() => void signOut()}>salir</button>; }
  render(<AuthProvider><Out /></AuthProvider>);
  await act(async () => { screen.getByText('salir').click(); });
  expect(assign).not.toHaveBeenCalled();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});
