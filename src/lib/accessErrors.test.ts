import { describe, expect, test } from 'vitest';
import { AccessError, classifyAuthError, isTemporaryAccessError, MAX_RETRY_AFTER_SECONDS, parseRetryAfter, retryAfterOf, temporaryCodeOf } from './accessErrors';
import { friendlyError } from './errors';

describe('Retry-After', () => {
  test('segundos enteros y decimales', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(' 12 ')).toBe(12);
    expect(parseRetryAfter('2.2')).toBe(3);
    expect(parseRetryAfter(9)).toBe(9);
    expect(parseRetryAfter('0')).toBe(0);
  });
  test('fecha HTTP', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(parseRetryAfter('Wed, 14 Oct 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Wed, 14 Oct 2026 11:00:00 GMT', now)).toBeUndefined(); // en el pasado
  });
  test('un valor absurdo no bloquea a nadie: se acota', () => {
    expect(parseRetryAfter('99999')).toBe(MAX_RETRY_AFTER_SECONDS);
  });
  test('basura o ausencia → sin dato', () => {
    for (const value of [undefined, null, '', 'pronto', '-5']) expect(parseRetryAfter(value as string | null | undefined)).toBeUndefined();
  });
});

describe('errores de Supabase Auth al iniciar sesión', () => {
  test('429 y los códigos de límite son RATE_LIMITED, nunca credenciales incorrectas', () => {
    expect(classifyAuthError({ status: 429, name: 'AuthApiError', message: 'Request rate limit reached' })?.code).toBe('RATE_LIMITED');
    expect(classifyAuthError({ code: 'over_request_rate_limit', message: 'x' })?.code).toBe('RATE_LIMITED');
    expect(classifyAuthError({ code: 'over_email_send_rate_limit', message: 'x' })?.code).toBe('RATE_LIMITED');
  });
  test('5xx, red caída y respuestas que no son de Auth son temporales', () => {
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })?.code).toBe('NETWORK');
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 503, message: 'x' })?.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(classifyAuthError({ status: 502, message: 'bad gateway' })?.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(classifyAuthError({ name: 'AuthUnknownError', message: '<html>' })?.code).toBe('TEMPORARILY_UNAVAILABLE');
    expect(classifyAuthError({ message: 'The operation was aborted' })?.code).toBe('TIMEOUT');
    expect(classifyAuthError({ status: 408, message: 'x' })?.code).toBe('NETWORK');
  });
  test('una contraseña realmente incorrecta o un rechazo de validación es definitivo (null)', () => {
    expect(classifyAuthError({ status: 400, code: 'invalid_credentials', name: 'AuthApiError', message: 'Invalid login credentials' })).toBeNull();
    expect(classifyAuthError({ status: 422, code: 'validation_failed', message: 'x' })).toBeNull();
    expect(classifyAuthError({ message: 'Invalid login credentials' })).toBeNull();
    expect(classifyAuthError(null)).toBeNull();
  });
});

describe('AccessError', () => {
  test('su mensaje es el código: friendlyError y las pantallas lo entienden sin cambios', () => {
    const error = new AccessError('RATE_LIMITED', 12);
    expect(error.message).toBe('RATE_LIMITED');
    expect(isTemporaryAccessError(error)).toBe(true);
    expect(retryAfterOf(error)).toBe(12);
    expect(temporaryCodeOf(error)).toBe('RATE_LIMITED');
  });
  test('un error con ese mensaje (de otra capa) también cuenta como temporal; los demás no', () => {
    for (const code of ['RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE', 'NETWORK', 'TIMEOUT']) expect(isTemporaryAccessError(new Error(code))).toBe(true);
    for (const code of ['INVALID_CREDENTIALS', 'INVALID_STAFF_CREDENTIALS', 'EMAIL_EXISTS', 'INVALID_PASSWORD', 'SERVER_ERROR', 'ABORTED']) expect(isTemporaryAccessError(new Error(code))).toBe(false);
    expect(isTemporaryAccessError('RATE_LIMITED')).toBe(false);
  });
  test('los mensajes para la persona nunca dicen contraseña incorrecta ni piden empezar de nuevo', () => {
    for (const code of ['RATE_LIMITED', 'TEMPORARILY_UNAVAILABLE', 'NETWORK', 'TIMEOUT']) {
      const text = friendlyError(new Error(code));
      expect(text).not.toMatch(/incorrect|inválid|desde el principio|empezar de nuevo/i);
      expect(text).toMatch(/inform|conexi|conserva|momentos|tard/i);
    }
    expect(friendlyError(new Error('RATE_LIMITED'))).toBe('Estamos recibiendo muchas solicitudes. Tu información se conserva. Intenta nuevamente en unos momentos.');
  });
});
