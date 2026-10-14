// Navegación de personas con la sesión ya abierta: talleres (tablero y detalle), recomendaciones, Mi ruta, Bitácora (sellos y
// progreso), estado del sorteo y estado de la encuesta. SOLO lectura. Cada usuario virtual es una persona distinta que repite acciones
// con esperas humanas (3–12 s) y una distribución de uso realista.
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { dataset } from '../lib/data.js';
import { assertSafe } from '../lib/env.js';
import { studentSession } from '../lib/session.js';
import { summarize } from '../lib/summary.js';
import { pick, think, weighted } from '../lib/think.js';
import { rpc } from '../lib/supabase.js';

export const options = {
  scenarios: { navigation: journey({ exec: 'browse' }) },
  thresholds: thresholds.merge(thresholds.health(), thresholds.reads()),
};

export function setup() { assertSafe({ supabase: true }); }

/** Con qué frecuencia hace cada cosa un alumno durante el evento. */
export const ACTIONS = { missions: 30, detail: 14, recommendations: 10, route: 12, logbook: 14, raffle: 8, prizes: 6, survey: 6 };

export function browse(slice) {
  const session = studentSession(slice);
  if (!session) return;
  const action = weighted(ACTIONS);
  let activities = [];
  switch (action) {
    case 'missions': case 'route': {            // «Misiones» y «Mi ruta» comparten el tablero de reservaciones
      const board = rpc(session, 'my_reservation_board', {});
      if (board.ok) activities = board.body.sessions.map((s) => s.activity_id);
      break;
    }
    case 'detail': {
      const ids = dataset().sessions.map((s) => s.activity_id);
      rpc(session, 'my_workshop_detail', { p_activity_id: pick(ids) });
      break;
    }
    case 'recommendations': rpc(session, 'my_recommended_activities', {}); break;
    case 'logbook': rpc(session, 'my_progress', {}); rpc(session, 'my_raffle_status', {}); break; // Bitácora: sellos + sorteo
    case 'raffle': rpc(session, 'my_raffle_status', {}); break;
    case 'prizes': rpc(session, 'my_raffle_prizes', {}); break;
    case 'survey': rpc(session, 'my_exit_survey', {}); break;
    default: break;
  }
  if (activities.length && Math.random() < 0.3) rpc(session, 'my_workshop_detail', { p_activity_id: pick(activities) });
  think(3, 12);
}

export const handleSummary = summarize('03-navigation');
