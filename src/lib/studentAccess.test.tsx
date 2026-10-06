import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { studentAccess } from './studentAccess';
import { supabase } from './supabase';

vi.mock('./supabase', () => ({
  functionsUrl: 'https://example.test/functions/v1',
  supabaseAnonKey: 'anon-key',
  supabase: {
    auth: {
      signInWithPassword: vi.fn(), signOut: vi.fn().mockResolvedValue({}),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(),
  },
}));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => body });

test('identify sends only the normalised email and returns just the state', async () => {
  reply({ state: 'password_setup' });
  await expect(studentAccess.identify(' Ana@Ejemplo.com ')).resolves.toBe('password_setup');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://example.test/functions/v1/student-access');
  expect(JSON.parse(init.body)).toEqual({ action: 'identify', email: 'ana@ejemplo.com' });
  expect(init.body).not.toMatch(/birth|nacimiento/i);
});

test('an unexpected state, an error code and a network failure are all surfaced as safe error codes', async () => {
  reply({ state: 'admin' });
  await expect(studentAccess.identify('a@b.co')).rejects.toThrow('SERVER_ERROR');
  reply({ error: 'EMAIL_EXISTS' }, false);
  await expect(studentAccess.register({
    email: 'a@b.co', password: 'clave-segura-1', first_name: 'A', last_name: 'B', phone: '9981234567', high_school: 'X',
    high_school_grade: '1', entry_period: '2027-01', initial_career_id: 'c', consent_accepted: true,
  })).rejects.toThrow('EMAIL_EXISTS');
  fetchMock.mockRejectedValue(new Error('offline'));
  await expect(studentAccess.setupPassword('a@b.co', 'clave-segura-1')).rejects.toThrow('NETWORK');
});

test('catalog returns the careers list, never personal data', async () => {
  reply({ careers: [{ id: 'c-1', name: 'Derecho', division: null }] });
  await expect(studentAccess.careers()).resolves.toEqual([{ id: 'c-1', name: 'Derecho', division: null }]);
});

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

test('participant sign-in uses Supabase Auth with email + password and accepts only participant identities', async () => {
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { user: { app_metadata: { kind: 'participant' } } }, error: null } as never);
  const { result } = renderHook(() => useAuth(), { wrapper });
  await act(() => result.current.signInParticipant(' Ana@Ejemplo.com ', 'clave-segura-1'));
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@ejemplo.com', password: 'clave-segura-1' });
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

test('wrong credentials and non-participant (Staff) identities both fail with the same generic code', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } } as never);
  await expect(result.current.signInParticipant('a@b.co', 'mala-clave-1')).rejects.toThrow('INVALID_CREDENTIALS');
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({ data: { user: { app_metadata: {} } }, error: null } as never);
  await expect(result.current.signInParticipant('staff@anahuac.mx', 'clave-staff-1')).rejects.toThrow('INVALID_CREDENTIALS');
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
});
