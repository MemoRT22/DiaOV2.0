import { Counter, Rate, Trend } from 'k6/metrics';

// ── Salud de la infraestructura (lo que SÍ cuenta como error) ────────────────────────────────────────────────────────────────
/** true = la petición falló por infraestructura (sin respuesta, 429, 5xx, función inexistente…). Un rechazo de NEGOCIO no cuenta. */
export const infraErrors = new Rate('infra_errors');
export const rateLimited = new Counter('rate_limited_responses');
export const unexpectedRejections = new Counter('unexpected_rejections');
/** Rechazos de negocio esperados (cupo lleno, conflicto de horario…), por código. Son el comportamiento correcto bajo contención. */
export const businessRejections = new Counter('business_rejections');

// ── Autenticación ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const authLogin = new Trend('auth_login_ms', true);
export const authOk = new Rate('auth_success');
export const auth429 = new Counter('auth_429');
export const authRetryExhausted = new Counter('auth_retry_exhausted');
export const authBootstrap = new Trend('auth_bootstrap_ms', true); // login + lecturas de arranque de la app
export const authAccesses = new Counter('auth_accesses_planned'); // exactamente una muestra por identidad planificada

// ── Estático ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const staticTtfb = new Trend('static_ttfb_ms', true);
export const staticTotal = new Trend('static_total_ms', true);
export const staticOk = new Rate('static_success');
export const staticCacheHit = new Rate('static_cache_hit');
export const staticBytes = new Counter('static_bytes');

// ── Reservaciones (integridad) ──────────────────────────────────────────────────────────────────────────────────────────────
export const reserveSuccess = new Counter('reserve_success');           // con tag session = id de sesión «caliente»
export const reserveFull = new Counter('reserve_full_rejected');
export const reserveConflict = new Counter('reserve_conflict_rejected');
export const reserveDuplicateRejected = new Counter('reserve_duplicate_rejected');
export const reserveMax = new Counter('reserve_max_rejected');
/** Violaciones: DEBEN ser 0. Cualquiera aborta la prueba. */
export const overbooking = new Counter('integrity_overbooking');
export const duplicateReservation = new Counter('integrity_duplicate_reservation');
export const conflictAccepted = new Counter('integrity_conflict_accepted');
export const maxExceeded = new Counter('integrity_max_reservations_exceeded');
export const duplicateSaved = new Counter('integrity_duplicate_saved');

// ── Asistencia y encuesta ─────────────────────────────────────────────────────────────────────────────────────────────────
export const checkinNew = new Counter('checkin_new');
export const checkinRepeat = new Counter('checkin_repeat_idempotent');
export const checkinNoReservation = new Counter('checkin_no_reservation');
export const checkinInvalid = new Counter('checkin_invalid_credential');
export const surveySaved = new Counter('survey_saved');
export const surveyAlready = new Counter('survey_already_completed');
export const surveyClaimed = new Counter('survey_invitation_claimed');

// ── Realtime ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const rtConnected = new Counter('realtime_connections_opened');
export const rtJoinMs = new Trend('realtime_join_ms', true);
export const rtJoinOk = new Rate('realtime_join_success');
export const rtMessages = new Counter('realtime_messages_received');
export const rtLagMs = new Trend('realtime_broadcast_lag_ms', true);
export const rtRecoveryMs = new Trend('realtime_recovery_ms', true);
export const rtRecoveryOk = new Rate('realtime_recovery_success');
export const rtDropped = new Counter('realtime_unexpected_closes');
