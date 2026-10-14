import http from 'k6/http';
import { check, sleep } from 'k6';
import { ENV } from './env.js';
import {
  auth429, authLogin, authOk, authRetryExhausted, businessRejections, infraErrors, rateLimited, unexpectedRejections,
} from './metrics.js';

// Respuestas 4xx de NEGOCIO (cupo lleno, conflicto…) son comportamiento esperado: no cuentan en `http_req_failed`. Solo 0, 429 y 5xx.
const EXPECTED = http.expectedStatuses({ min: 200, max: 299 }, { min: 400, max: 409 });
/** Códigos de negocio que el sistema devuelve a propósito. Cualquier otro 4xx se registra como rechazo INESPERADO y cuenta como error. */
export const BUSINESS_CODES = new Set([
  'SESSION_FULL', 'ALREADY_RESERVED', 'SAME_WORKSHOP', 'SCHEDULE_CONFLICT', 'MAX_RESERVATIONS', 'ALREADY_ATTENDED', 'SESSION_ENDED',
  'SESSION_CANCELLED', 'SESSION_UNAVAILABLE', 'RESERVATIONS_NOT_OPEN', 'RESERVATIONS_CLOSED', 'NO_RESERVATION', 'INVALID_CREDENTIAL',
  'RESERVATION_NOT_FOUND', 'SURVEY_NOT_OPEN', 'INVALID_SURVEY_ANSWERS',
]);

const base = () => ENV.supabaseUrl;
const anonHeaders = () => ({ apikey: ENV.anonKey, 'Content-Type': 'application/json' });
const authHeaders = (session) => ({ apikey: ENV.anonKey, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' });
const tagsOf = (op, extra) => ({ op, ...(extra || {}) });

/** Ordena un fallo: 'network' | 'rate_limited' | 'server' | 'auth' | 'client' | null (sin fallo). */
export function classify(response) {
  if (response.status === 0) return 'network';
  if (response.status === 429) return 'rate_limited';
  if (response.status >= 500) return 'server';
  if (response.status === 401 || response.status === 403) return 'auth';
  return null;
}

function json(response) {
  try { return response.json(); } catch (_) { return null; }
}

/** Lo que dice un 4xx de PostgREST: { code, message }. `message` es el código de negocio levantado por la función. */
export function businessCode(response) {
  const body = json(response);
  return body && typeof body.message === 'string' ? body.message : '';
}

/** Registra el resultado en las métricas de salud. Devuelve { ok, business, code }. */
function account(response, op) {
  const failure = classify(response);
  if (failure === 'rate_limited') rateLimited.add(1, tagsOf(op));
  if (failure) { infraErrors.add(true, tagsOf(op)); return { ok: false, business: false, code: failure }; }
  if (response.status >= 400) {
    const code = businessCode(response);
    if (BUSINESS_CODES.has(code)) { infraErrors.add(false, tagsOf(op)); businessRejections.add(1, tagsOf(op, { code })); return { ok: false, business: true, code }; }
    unexpectedRejections.add(1, tagsOf(op, { code: code || String(response.status) }));
    infraErrors.add(true, tagsOf(op));
    return { ok: false, business: false, code: code || `HTTP_${response.status}` };
  }
  infraErrors.add(false, tagsOf(op));
  return { ok: true, business: false, code: '' };
}

const jitter = (seconds) => seconds * (0.85 + Math.random() * 0.3);
function retryAfter(response) {
  const value = Number(response.headers['Retry-After'] || response.headers['retry-after']);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 30) : 0;
}

/**
 * Inicio de sesión REAL (grant_type=password de Supabase Auth) de una persona. Mismo comportamiento que la aplicación ante un 429:
 * hasta 2 reintentos, respetando `Retry-After` (con tope) y con espera progresiva más azar; nunca infinito.
 */
export function login(user, { retries = 2, op = 'auth_token' } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = http.post(`${base()}/auth/v1/token?grant_type=password`, JSON.stringify({ email: user.email, password: user.password }), {
      headers: anonHeaders(), tags: tagsOf(op, { kind: 'auth' }), responseCallback: EXPECTED,
    });
    last = response;
    authLogin.add(response.timings.duration, { attempt: String(attempt) });
    if (response.status === 429) {
      auth429.add(1);
      infraErrors.add(true, tagsOf(op)); rateLimited.add(1, tagsOf(op));
      if (attempt < retries) { sleep(Math.max(retryAfter(response), jitter(1.5 * 2 ** attempt))); continue; }
      authRetryExhausted.add(1);
      break;
    }
    break;
  }
  const failure = classify(last);
  if (failure && failure !== 'rate_limited') infraErrors.add(true, tagsOf(op));
  const body = json(last);
  const ok = last.status === 200 && body && typeof body.access_token === 'string';
  if (!failure) infraErrors.add(false, tagsOf(op));
  authOk.add(!!ok);
  check(last, { 'login 200 con token': () => !!ok });
  if (!ok) return { ok: false, status: last.status, code: failure || (body && (body.error_code || body.msg)) || `HTTP_${last.status}` };
  return {
    ok: true, status: 200, userIndex: user.index, email: user.email, accessToken: body.access_token, refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000, userId: body.user && body.user.id,
  };
}

/** Renueva el token con el refresh_token (como el cliente real) cuando falta poco para que venza. */
export function ensureFresh(session, marginMs = 120000) {
  if (!session || Date.now() < session.expiresAt - marginMs) return session;
  const response = http.post(`${base()}/auth/v1/token?grant_type=refresh_token`, JSON.stringify({ refresh_token: session.refreshToken }), {
    headers: anonHeaders(), tags: tagsOf('auth_refresh', { kind: 'auth' }), responseCallback: EXPECTED,
  });
  const failure = classify(response);
  infraErrors.add(!!failure, tagsOf('auth_refresh'));
  const body = json(response);
  if (response.status === 200 && body && body.access_token) {
    return { ...session, accessToken: body.access_token, refreshToken: body.refresh_token || session.refreshToken, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  }
  return session;
}

/** Llamada a una función RPC de PostgREST (`/rest/v1/rpc/<nombre>`) como la persona autenticada. */
export function rpc(session, name, args, { op = name, extraTags } = {}) {
  const response = http.post(`${base()}/rest/v1/rpc/${name}`, JSON.stringify(args || {}), {
    headers: authHeaders(session), tags: tagsOf(op, { kind: 'rpc', ...(extraTags || {}) }), responseCallback: EXPECTED,
  });
  const outcome = account(response, op);
  return { ...outcome, status: response.status, body: outcome.ok ? json(response) : null, duration: response.timings.duration };
}

/** Lectura directa de una tabla vía PostgREST (las pocas consultas de arranque que hace la aplicación). */
export function rest(session, path, { op } = {}) {
  const response = http.get(`${base()}/rest/v1/${path}`, { headers: authHeaders(session), tags: tagsOf(op || path.split('?')[0], { kind: 'rest' }), responseCallback: EXPECTED });
  const outcome = account(response, op || path.split('?')[0]);
  return { ...outcome, status: response.status, body: outcome.ok ? json(response) : null, duration: response.timings.duration };
}

/** Función Edge pública (`student-access`: identificar el correo). Solo lectura. */
export function edge(name, body, { op } = {}) {
  const response = http.post(`${base()}/functions/v1/${name}`, JSON.stringify(body), { headers: anonHeaders(), tags: tagsOf(op || name, { kind: 'edge' }), responseCallback: EXPECTED });
  const outcome = account(response, op || name);
  return { ...outcome, status: response.status, body: outcome.ok ? json(response) : null, duration: response.timings.duration };
}

/** La lectura de arranque de la aplicación del alumno justo después de iniciar sesión (4 consultas, como `src/`). */
export function bootstrap(session) {
  const reads = [
    ['editions?select=*&is_active=eq.true', 'boot_edition'],
    [`participant_profiles?select=participant_id,display_name,high_school,platform_consent_at,platform_consent_version&auth_user_id=eq.${session.userId}`, 'boot_profile'],
    [`staff_members?select=user_id,full_name,is_active,staff_roles(role)&user_id=eq.${session.userId}`, 'boot_staff'],
  ];
  const results = reads.map(([path, op]) => rest(session, path, { op }));
  const edition = results[0].body && results[0].body[0];
  if (edition) results.push(rest(session, `theme_versions?select=config&edition_id=eq.${edition.id}&status=eq.published`, { op: 'boot_theme' }));
  return { edition, results };
}
