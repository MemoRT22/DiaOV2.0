import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { AccessError, MAX_RETRY_AFTER_SECONDS } from './accessErrors';
import { ACCESS_TIMEOUT_MS, studentAccess } from './studentAccess';
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

test('an unreadable state, an error code and a network failure are all surfaced as safe error codes', async () => {
  reply({ state: 'admin' });
  await expect(studentAccess.identify('a@b.co')).rejects.toThrow('TEMPORARILY_UNAVAILABLE'); // respuesta ilegible: no es un dato de la persona
  reply({ error: 'EMAIL_EXISTS' }, false);
  await expect(studentAccess.register({
    email: 'a@b.co', password: 'clave-segura-1', first_name: 'A', last_name: 'B', phone: '9981234567', high_school_id: 'h-1',
    high_school_grade: '1', entry_period: '2027-01', initial_career_id: 'c', consent_accepted: true,
  })).rejects.toThrow('EMAIL_EXISTS');
  fetchMock.mockRejectedValue(new Error('offline'));
  await expect(studentAccess.setupPassword('a@b.co', 'clave-segura-1')).rejects.toThrow('NETWORK');
});

test('catalog returns careers and active schools in one request', async () => {
  reply({ careers: [{ id: 'c-1', name: 'Derecho', division: null }], high_schools: [{ id: 'h-1', name: 'Otra escuela' }] });
  await expect(studentAccess.catalog()).resolves.toEqual({ careers: [{ id: 'c-1', name: 'Derecho', division: null }], high_schools: [{ id: 'h-1', name: 'Otra escuela' }] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
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

// ============================================================ límites (429) y caídas temporales

const http = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new SyntaxError('not json'); return body; },
});
const credentials = { email: 'a@b.co', password: 'clave-segura-1', first_name: 'A', last_name: 'B', phone: '9981234567', high_school_id: 'h-1', high_school_grade: '1', entry_period: '2027-01', initial_career_id: 'c', consent_accepted: true };

test('a 429 is RATE_LIMITED with the Retry-After the server sent, and never a data error', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(http(429, { error: 'RATE_LIMITED', retry_after: 12 }, { 'Retry-After': '45' }));
  const outcome = studentAccess.setupPassword('a@b.co', 'clave-segura-1').catch((cause) => cause);
  const error = await outcome;
  expect(error).toBeInstanceOf(AccessError);
  expect(error.message).toBe('RATE_LIMITED');
  expect(error.retryAfterSeconds).toBe(45); // el encabezado manda sobre el cuerpo
  vi.useRealTimers();
});

test('Retry-After falls back to the body, and a bare gateway 429 (no body) is still RATE_LIMITED', async () => {
  fetchMock.mockResolvedValueOnce(http(429, { error: 'RATE_LIMITED', retry_after: 12 }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'RATE_LIMITED', retryAfterSeconds: 12 });
  fetchMock.mockResolvedValueOnce(http(429, undefined, { 'Retry-After': '3' }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'RATE_LIMITED', retryAfterSeconds: 3 });
  fetchMock.mockResolvedValueOnce(http(429, undefined));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'RATE_LIMITED', retryAfterSeconds: undefined });
});

test('503 and gateway failures are temporary; a 503 that carries a business code is not', async () => {
  for (const status of [502, 503, 504, 546, 408]) {
    fetchMock.mockResolvedValueOnce(http(status, undefined));
    await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'TEMPORARILY_UNAVAILABLE' });
  }
  fetchMock.mockResolvedValueOnce(http(503, { error: 'TEMPORARILY_UNAVAILABLE', retry_after: 6 }, { 'Retry-After': '6' }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'TEMPORARILY_UNAVAILABLE', retryAfterSeconds: 6 });
  fetchMock.mockResolvedValueOnce(http(503, { error: 'NO_ACTIVE_EDITION' }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'NO_ACTIVE_EDITION' });
});

test('HTTP 500 is infrastructure, with or without a body: the outcome is uncertain, so it is temporary and never a data error', async () => {
  for (const reply500 of [http(500, { error: 'SERVER_ERROR' }), http(500, undefined), http(500, {}), http(500, { error: 'ALGO_NUEVO' }), http(500, 'texto' as never)]) {
    fetchMock.mockResolvedValueOnce(reply500);
    const error = await studentAccess.register(credentials).catch((cause) => cause);
    expect(error).toBeInstanceOf(AccessError);
    expect(error.message).toBe('TEMPORARILY_UNAVAILABLE');
  }
  // un 200 cuyo cuerpo se cortó o no es JSON tampoco dice nada de los datos
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new SyntaxError('cut'); } });
  await expect(studentAccess.setupPassword('a@b.co', 'clave-segura-1')).rejects.toMatchObject({ message: 'TEMPORARILY_UNAVAILABLE' });
});

test('business codes stay definitive (4xx, and the one state the server emits with 503)', async () => {
  for (const [status, code] of [[503, 'NO_ACTIVE_EDITION'], [400, 'INVALID_PHONE'], [409, 'ACCOUNT_RECOVERY_REQUIRED'], [409, 'EMAIL_EXISTS']] as const) {
    fetchMock.mockResolvedValueOnce(http(status, { error: code }));
    const error = await studentAccess.register(credentials).catch((cause) => cause);
    expect(error).not.toBeInstanceOf(AccessError);
    expect(error.message).toBe(code);
  }
});

test('a 500 is NEVER repeated by itself on writes (one send per decision) but reads retry a bounded number of times', async () => {
  vi.useFakeTimers();
  for (const failure of [http(500, { error: 'SERVER_ERROR' }), http(500, undefined)]) {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(failure);
    const setup = studentAccess.setupPassword('a@b.co', 'clave-segura-1').catch((cause) => cause);
    const register = studentAccess.register(credentials).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await setup).message).toBe('TEMPORARILY_UNAVAILABLE');
    expect((await register).message).toBe('TEMPORARILY_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }
  fetchMock.mockClear();
  fetchMock.mockResolvedValue(http(500, { error: 'SERVER_ERROR' }));
  const read = studentAccess.identify('a@b.co').catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await read).message).toBe('TEMPORARILY_UNAVAILABLE');
  expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 reintentos
  vi.useRealTimers();
});

test('Retry-After above two minutes is honoured as the server sent it; an absurd value is bounded; automatic retries do not wait for it', async () => {
  fetchMock.mockResolvedValueOnce(http(429, { error: 'RATE_LIMITED' }, { 'Retry-After': '300' }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'RATE_LIMITED', retryAfterSeconds: 300 });
  fetchMock.mockResolvedValueOnce(http(503, undefined, { 'Retry-After': '900' }));
  await expect(studentAccess.setupPassword('a@b.co', 'clave-segura-1')).rejects.toMatchObject({ message: 'TEMPORARILY_UNAVAILABLE', retryAfterSeconds: 900 });
  fetchMock.mockResolvedValueOnce(http(429, undefined, { 'Retry-After': '9999999' }));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ retryAfterSeconds: MAX_RETRY_AFTER_SECONDS });

  vi.useFakeTimers();
  fetchMock.mockClear();
  fetchMock.mockResolvedValue(http(429, { error: 'RATE_LIMITED' }, { 'Retry-After': '300' }));
  const read = studentAccess.identify('a@b.co').catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(30_000);
  const error = await read;
  expect(error.retryAfterSeconds).toBe(300);
  expect(fetchMock).toHaveBeenCalledTimes(1); // no se esperó 5 minutos en segundo plano: lo decide la persona con la cuenta atrás
  vi.useRealTimers();
});

test('validation errors and conflicts keep their own code (no retry, no temporary notice)', async () => {
  for (const [status, code] of [[400, 'INVALID_PASSWORD'], [409, 'EMAIL_EXISTS'], [409, 'ACCESS_ALREADY_CONFIGURED'], [404, 'NOT_FOUND']] as const) {
    fetchMock.mockResolvedValueOnce(http(status, { error: code }));
    await expect(studentAccess.setupPassword('a@b.co', 'clave-segura-1')).rejects.toMatchObject({ message: code });
  }
});

test('a lost connection is NETWORK and a request that never answers is TIMEOUT (outcome uncertain)', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(studentAccess.register(credentials)).rejects.toMatchObject({ message: 'NETWORK' });
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  const pending = studentAccess.register(credentials).catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(ACCESS_TIMEOUT_MS + 10);
  expect((await pending).message).toBe('TIMEOUT');
  vi.useRealTimers();
});

test('identify (read-only) retries by itself on a limit, with progressive waits, and then succeeds', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(http(429, { error: 'RATE_LIMITED' })).mockResolvedValueOnce(http(503, undefined)).mockResolvedValue(http(200, { state: 'password_login' }));
  const result = studentAccess.identify('a@b.co');
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(result).resolves.toBe('password_login');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  vi.useRealTimers();
});

test('identify gives up after a bounded number of tries and reports the temporary error', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValue(http(429, { error: 'RATE_LIMITED' }));
  const result = studentAccess.identify('a@b.co').catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await result).message).toBe('RATE_LIMITED');
  expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 reintentos, ni uno más
  vi.useRealTimers();
});

test('catalog retries the same way (read-only)', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(http(503, undefined)).mockResolvedValue(http(200, { careers: [], high_schools: [] }));
  const result = studentAccess.catalog();
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(result).resolves.toEqual({ careers: [], high_schools: [] });
  vi.useRealTimers();
});

test('setup_password and register are NEVER repeated by themselves: one send per decision of the person', async () => {
  vi.useFakeTimers();
  for (const failure of [http(429, { error: 'RATE_LIMITED' }), http(503, undefined)]) {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(failure);
    const setup = studentAccess.setupPassword('a@b.co', 'clave-segura-1').catch((cause) => cause);
    const register = studentAccess.register(credentials).catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all([setup, register]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // una por operación
  }
  fetchMock.mockClear();
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  const lost = studentAccess.register(credentials).catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await lost).message).toBe('NETWORK');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test('leaving the screen cancels the request and its background retries', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  fetchMock.mockResolvedValue(http(429, { error: 'RATE_LIMITED' }));
  const result = studentAccess.identify('a@b.co', { signal: controller.signal }).catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await result).message).toBe('ABORTED');
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  const before = fetchMock.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock.mock.calls.length).toBe(before); // nada sigue corriendo
  vi.useRealTimers();
});

test('the request body never carries anything but what the action needs (no secrets in errors)', async () => {
  fetchMock.mockResolvedValue(http(429, { error: 'RATE_LIMITED' }));
  const error = await studentAccess.setupPassword('a@b.co', 'clave-segura-1').catch((cause) => cause);
  expect(JSON.stringify({ message: error.message, name: error.name })).not.toContain('clave-segura-1');
});

// ============================================================ inicio de sesión: contraseña incorrecta ≠ servicio saturado

const authFailure = (over: Record<string, unknown>) => ({ data: { user: null }, error: { message: 'x', ...over } }) as never;
const signIn = vi.mocked(supabase.auth.signInWithPassword);

test('a wrong password is INVALID_CREDENTIALS; a 429 on the very same request is RATE_LIMITED and never a wrong password', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  signIn.mockResolvedValueOnce(authFailure({ status: 400, code: 'invalid_credentials', name: 'AuthApiError', message: 'Invalid login credentials' }));
  await expect(result.current.signInParticipant('a@b.co', 'mala-clave-1')).rejects.toThrow('INVALID_CREDENTIALS');
  expect(signIn).toHaveBeenCalledTimes(1); // un rechazo definitivo no se reintenta

  vi.useFakeTimers();
  signIn.mockClear();
  signIn.mockResolvedValue(authFailure({ status: 429, code: 'over_request_rate_limit', name: 'AuthApiError', message: 'Request rate limit reached' }));
  const limited = result.current.signInParticipant('a@b.co', 'clave-correcta-1').catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(60_000);
  const error = await limited;
  expect(error.message).toBe('RATE_LIMITED');
  expect(error.message).not.toBe('INVALID_CREDENTIALS');
  expect(signIn).toHaveBeenCalledTimes(3); // 1 + 2 reintentos, acotados
  vi.useRealTimers();
});

test('Staff: wrong credentials stay INVALID_STAFF_CREDENTIALS; a 429, a 503 or no network are never reported as wrong credentials', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  signIn.mockResolvedValueOnce(authFailure({ status: 400, name: 'AuthApiError', message: 'Invalid login credentials' }));
  await expect(result.current.signInStaff('staff@anahuac.mx', 'mala')).rejects.toThrow('INVALID_STAFF_CREDENTIALS');
  vi.useFakeTimers();
  for (const [failure, code] of [
    [{ status: 429, name: 'AuthApiError' }, 'RATE_LIMITED'],
    [{ status: 503, name: 'AuthRetryableFetchError' }, 'TEMPORARILY_UNAVAILABLE'],
    [{ status: 0, name: 'AuthRetryableFetchError', message: 'Failed to fetch' }, 'NETWORK'],
  ] as const) {
    signIn.mockResolvedValue(authFailure(failure));
    const attempt = result.current.signInStaff('staff@anahuac.mx', 'clave-staff-1').catch((cause) => cause);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await attempt).message).toBe(code);
  }
  vi.useRealTimers();
});

test('a temporary failure followed by success signs in without bothering the person', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  vi.useFakeTimers();
  signIn.mockResolvedValueOnce(authFailure({ status: 429, name: 'AuthApiError' }))
    .mockResolvedValue({ data: { user: { app_metadata: { kind: 'participant' } } }, error: null } as never);
  const done = result.current.signInParticipant('a@b.co', 'clave-correcta-1');
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(done).resolves.toBeUndefined();
  expect(signIn).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

test('an existing session survives a limited sign-in attempt: nothing signs out', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  vi.useFakeTimers();
  signIn.mockResolvedValue(authFailure({ status: 429, name: 'AuthApiError' }));
  const attempt = result.current.signInParticipant('a@b.co', 'clave-correcta-1').catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await attempt).message).toBe('RATE_LIMITED');
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test('a Staff account signing in through the participant screen is still refused and signed out (no regression)', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  signIn.mockResolvedValue({ data: { user: { app_metadata: {} } }, error: null } as never);
  await expect(result.current.signInParticipant('staff@anahuac.mx', 'clave-staff-1')).rejects.toThrow('INVALID_CREDENTIALS');
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
  await expect(result.current.signInStaff('staff@anahuac.mx', 'clave-staff-1')).resolves.toBeUndefined();
});

test('leaving the screen cancels the sign-in retries', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  vi.useFakeTimers();
  const controller = new AbortController();
  signIn.mockResolvedValue(authFailure({ status: 429, name: 'AuthApiError' }));
  const attempt = result.current.signInParticipant('a@b.co', 'clave-correcta-1', { signal: controller.signal }).catch((cause) => cause);
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await attempt).message).toBe('ABORTED');
  expect(signIn.mock.calls.length).toBeLessThanOrEqual(2);
  vi.useRealTimers();
});
