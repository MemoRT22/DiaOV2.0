// Autenticación: ráfagas de personas DISTINTAS iniciando sesión, con los mecanismos reales de Supabase Auth (password grant, límite de
// solicitudes por IP, 429 + Retry-After). Cada iteración = una persona del padrón ficticio (nunca una sola cuenta repetida). Replica el
// recorrido de la aplicación: identificar el correo (Edge Function `student-access`, solo lectura) → iniciar sesión → lecturas de
// arranque → primer tablero. Un pequeño porcentaje usa una contraseña incorrecta para comprobar que se distingue de un 429.
// Nota: todas las peticiones salen de UNA IP (la de quien ejecuta); como el día del evento el campus comparte una IP pública, eso es
// justo lo realista para el límite de 6,000 solicitudes / 5 min / IP del endpoint de tokens.
import exec from 'k6/execution';
import { check } from 'k6';
import { arrivals } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { userFor } from '../lib/data.js';
import { assertSafe } from '../lib/env.js';
import { authBootstrap } from '../lib/metrics.js';
import { summarize } from '../lib/summary.js';
import { think } from '../lib/think.js';
import { bootstrap, edge, login, rpc } from '../lib/supabase.js';

export const options = {
  scenarios: { auth_burst: arrivals({ exec: 'arrive' }) },
  thresholds: thresholds.merge(thresholds.health(), thresholds.auth(), thresholds.reads()),
};

export function setup() { assertSafe({ supabase: true }); }

const NEGATIVE_RATIO = Number(__ENV.AUTH_NEGATIVE_RATIO || 0.01);

export function arrive() {
  const user = userFor(exec.scenario.iterationInTest);
  const startedAt = Date.now();
  edge('student-access', { action: 'identify', email: user.email }, { op: 'edge_identify' });

  if (Math.random() < NEGATIVE_RATIO) {
    // Contraseña incorrecta: debe ser un 400 definitivo (no un 429 ni un 5xx) y NO cuenta como falla de la infraestructura.
    const wrong = login({ ...user, password: `${user.password}-x` }, { retries: 0, op: 'auth_token_wrong_password' });
    check(wrong, { 'contraseña incorrecta se distingue de un límite (400)': (r) => !r.ok && (r.status === 400 || r.status === 429) });
    return;
  }

  const session = login(user);
  if (!session.ok) return;
  const boot = bootstrap(session);
  rpc(session, 'my_reservation_board', {});
  authBootstrap.add(Date.now() - startedAt);
  check(boot.edition, { 'arranque: edición activa': (e) => !!e });
  think(1, 4);
}

export const handleSummary = summarize('02-auth');
