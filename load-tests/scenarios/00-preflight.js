// Verificación previa (1 persona, 1 iteración). Comprueba, SIN escribir nada, que el entorno de pruebas es el esperado: que las guardas
// de seguridad pasan, que el padrón ficticio inicia sesión de verdad en Supabase Auth, que las lecturas de la aplicación responden y
// que el manifiesto de datos coincide con lo que hay en la base. Ejecútalo SIEMPRE antes de cualquier otro escenario.
import { check, fail } from 'k6';
import { dataset, userAt } from '../lib/data.js';
import { assertSafe, ENV } from '../lib/env.js';
import { summarize } from '../lib/summary.js';
import { bootstrap, login, rpc } from '../lib/supabase.js';

export const options = { scenarios: { preflight: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '2m' } }, thresholds: { checks: ['rate==1'] } };

export function setup() { return assertSafe({ supabase: true, writes: true }); }

export default function (mode) {
  const manifest = dataset();
  console.log(`Entorno: ${ENV.targetEnv} · ${ENV.supabaseUrl} · escrituras ${mode.readOnly ? 'DESHABILITADAS (solo lectura)' : 'habilitadas'}`);
  console.log(`Padrón ficticio: ${manifest.users.count} personas · ${manifest.sessions.length} sesiones · ${manifest.credentials.length} credenciales`);
  const session = login(userAt(0));
  if (!session.ok) fail(`El usuario ficticio 0 no pudo iniciar sesión (${session.code}). ¿Se aplicó seed.sql en ESTE proyecto y está activo el inicio de sesión con correo?`);
  const boot = bootstrap(session);
  check(boot.edition, { 'hay una edición activa': (e) => !!e });
  check(boot.edition, { 'la edición está en preparación (ensayo)': (e) => !!e && e.mode === 'preparacion' });
  const board = rpc(session, 'my_reservation_board', {});
  check(board, { 'tablero de reservaciones responde': (r) => r.ok && Array.isArray(r.body.sessions) });
  if (board.ok) {
    const ids = new Set(board.body.sessions.map((s) => s.id));
    const missing = manifest.sessions.filter((s) => !ids.has(s.id));
    check(missing, { 'todas las sesiones del manifiesto existen para el alumno': (m) => m.length === 0 });
    check(board.body, { 'las reservaciones están abiertas': (b) => b.window === 'open' });
  }
  const survey = rpc(session, 'my_exit_survey', {});
  check(survey, { 'estado de la encuesta responde': (r) => r.ok && typeof r.body.is_open === 'boolean' });
  check(rpc(session, 'my_progress', {}), { 'progreso (sellos) responde': (r) => r.ok });
  check(rpc(session, 'my_raffle_status', {}), { 'estado del sorteo responde': (r) => r.ok });
}

export const handleSummary = summarize('00-preflight');
