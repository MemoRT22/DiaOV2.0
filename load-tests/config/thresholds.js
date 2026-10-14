import { ENV } from '../lib/env.js';

/*
 * Umbrales (SLO) y condiciones de PARADA AUTOMÁTICA (`abortOnFail`). Una prueba que supera un umbral de parada se detiene sola:
 * seguir presionando un sistema que ya no responde solo agrava el daño y ensucia los datos.
 *
 * Los de latencia son para p95/p99 por operación. En `stress` y `spike` se relajan (el objetivo es hallar el quiebre, no cumplir el
 * SLO), pero los de INTEGRIDAD y los de parada nunca se relajan.
 */
const relaxed = () => ['stress', 'spike'].includes(ENV.profile);
const f = (value) => (relaxed() ? value * 2 : value);
const stop = (threshold, delay = '1m') => ({ threshold, abortOnFail: true, delayAbortEval: delay });

/** Integridad: cualquier violación detiene la prueba al instante. */
export const integrity = () => ({
  integrity_overbooking: [stop('count==0', '0s')],
  integrity_duplicate_reservation: [stop('count==0', '0s')],
  integrity_conflict_accepted: [stop('count==0', '0s')],
  integrity_max_reservations_exceeded: [stop('count==0', '0s')],
  integrity_duplicate_saved: [stop('count==0', '0s')],
});

/** Salud general de la infraestructura. */
export const health = () => ({
  infra_errors: [relaxed() ? 'rate<0.05' : 'rate<0.01', stop('rate<0.10')],
  unexpected_rejections: ['count<50'],
  http_req_failed: [stop('rate<0.15', '2m')],
  http_req_duration: [stop('p(99)<15000', '2m')], // un p99 de 15 s ya es una caída percibida
});

export const auth = () => ({
  auth_success: ['rate>0.98', stop('rate>0.80', '1m')],
  auth_login_ms: [`p(95)<${f(1500)}`, `p(99)<${f(3000)}`],
  auth_bootstrap_ms: [`p(95)<${f(2500)}`],
  'http_req_duration{op:edge_identify}': [`p(95)<${f(800)}`, `p(99)<${f(2000)}`],
});

const readOps = ['my_reservation_board', 'my_progress', 'my_raffle_status', 'my_raffle_prizes', 'my_exit_survey', 'my_workshop_detail', 'my_recommended_activities'];
export const reads = () => Object.fromEntries(readOps.map((op) => [`http_req_duration{op:${op}}`, [`p(95)<${f(600)}`, `p(99)<${f(1500)}`]]));

const writeOps = ['reserve_session', 'cancel_reservation', 'change_reservation', 'check_in', 'submit_exit_survey', 'exit_survey_mark_invited'];
export const writes = () => Object.fromEntries(writeOps.map((op) => [`http_req_duration{op:${op}}`, [`p(95)<${f(1200)}`, `p(99)<${f(3000)}`]]));

export const realtime = () => ({
  realtime_join_success: ['rate>0.99'],
  realtime_join_ms: [`p(95)<${f(3000)}`, `p(99)<${f(6000)}`],
  realtime_broadcast_lag_ms: [`p(95)<${f(2000)}`, `p(99)<${f(5000)}`],
  realtime_recovery_ms: [`p(95)<${f(8000)}`],
  realtime_recovery_success: ['rate>0.95'],
});

export const statics = () => ({
  static_success: ['rate>0.99', stop('rate>0.90', '1m')],
  'static_ttfb_ms{component:netlify_html}': [`p(95)<${f(800)}`],
  'static_ttfb_ms{component:netlify_assets}': [`p(95)<${f(800)}`, `p(99)<${f(2000)}`],
  'static_total_ms{component:institutional}': [`p(95)<${f(2500)}`],
  'static_total_ms{component:netlify_assets}': [`p(95)<${f(2500)}`],
});

export const merge = (...parts) => Object.assign({}, ...parts);
