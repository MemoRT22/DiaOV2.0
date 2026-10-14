// Día del evento completo: todos los recorridos corren A LA VEZ, repartiendo el padrón ficticio en cohortes DISJUNTAS para que cada
// cuenta represente a una persona y haga una sola cosa. La ráfaga de autenticación se ejecuta aparte con 02-auth.js; cada recorrido
// de esta prueba ya inicia una sesión real durante su rampa, por lo que agregar otra ola inflaría artificialmente el total sobre 2,000.
// Es la prueba de aceptación (perfil peak2000 = 2,000 personas). Navegación 55 %, reservaciones 25 %, asistencia 8 %, encuesta 6 %,
// tiempo real 6 %. Más el inicio de sesión escalonado. Escrituras solo con LOADTEST_ALLOW_WRITES. El acceso estático (Netlify/HubSpot)
// NO se incluye: requiere autorización de terceros y se ejecuta aparte con 01-static.js.
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { assertSafe } from '../lib/env.js';
import { sessionsOf, validateDataset } from '../lib/data.js';
import { summarize } from '../lib/summary.js';
import { browse } from './03-navigation.js';
import { contention, steady } from './04-reservations.js';
import { scan } from './05-checkin.js';
import { answer } from './06-survey.js';
import { listen } from './07-realtime.js';

const caps = () => Object.fromEntries(sessionsOf('hot').map((s) => [`reserve_success{session:${s.id}}`, [{ threshold: `count<=${s.capacity}`, abortOnFail: true, delayAbortEval: '0s' }]]));

export const options = {
  scenarios: {
    navigation: journey({ exec: 'navigationFlow', fullDayFlow: 'navigation', tags: { flow: 'navigation' } }),
    reservations_contention: journey({ exec: 'contentionFlow', fullDayFlow: 'reservations_contention', tags: { flow: 'contention' } }),
    reservations_steady: journey({ exec: 'steadyFlow', fullDayFlow: 'reservations_steady', tags: { flow: 'steady' } }),
    checkin: journey({ exec: 'checkinFlow', fullDayFlow: 'checkin', tags: { flow: 'checkin' } }),
    survey: journey({ exec: 'surveyFlow', fullDayFlow: 'survey', tags: { flow: 'survey' } }),
    realtime: journey({ exec: 'realtimeFlow', fullDayFlow: 'realtime', tags: { flow: 'realtime' } }),
  },
  thresholds: thresholds.merge(thresholds.health(), thresholds.auth(), thresholds.integrity(), thresholds.reads(), thresholds.writes(), thresholds.realtime(), caps()),
};

export function setup() { validateDataset(); return assertSafe({ supabase: true, writes: true }); }

export function navigationFlow() { browse(undefined, true); }
export function contentionFlow() { contention(undefined, true); }
export function steadyFlow() { steady(undefined, true); }
export function checkinFlow() { scan(undefined, true); }
export function surveyFlow() { answer(undefined, true); }
export function realtimeFlow() { listen(undefined, true); }

export const handleSummary = summarize('99-full-day');
