// Encuesta de salida: `my_exit_survey` (estado), `exit_survey_mark_invited` (reclamo atómico del popup) y `submit_exit_survey` con
// datos de ENSAYO. Comprueba el contrato del servidor bajo concurrencia: cada persona guarda UNA sola encuesta; el reenvío (doble
// clic / conexión perdida) responde «ya completada» sin duplicar ni sobrescribir. El estado de la encuesta se consulta con la
// cadencia real de la aplicación. ESCRIBE: exige LOADTEST_ALLOW_WRITES. Restablecer: `psql -f data/reset-run.sql`.
import { journey } from '../config/profiles.js';
import * as thresholds from '../config/thresholds.js';
import { ENV, assertSafe } from '../lib/env.js';
import { duplicateSaved, surveyAlready, surveyClaimed, surveySaved } from '../lib/metrics.js';
import { studentSession } from '../lib/session.js';
import { summarize } from '../lib/summary.js';
import { chance, pick, think } from '../lib/think.js';
import { rpc } from '../lib/supabase.js';

export const options = {
  scenarios: { survey: journey({ exec: 'answer' }) },
  thresholds: thresholds.merge(thresholds.health(), thresholds.integrity(), thresholds.reads(), thresholds.writes()),
};

export function setup() { return assertSafe({ supabase: true, writes: true }); }

const Q1 = ['tenia_carrera', 'entre_varias', 'area_sin_carrera', 'sin_idea'];
const Q3 = ['ya_claro', 'algunas_opciones', 'descubri_area', 'seguir_explorando'];
const AREAS = ['salud', 'deporte', 'negocios', 'derecho_ri', 'liderazgo', 'arquitectura_diseno', 'ingenierias', 'comunicacion_creativas'];

/** Un cuestionario válido, igual en forma al que envía la aplicación. */
function payload() {
  const count = 1 + Math.floor(Math.random() * 3);
  const areas = [...AREAS].sort(() => Math.random() - 0.5).slice(0, count);
  return { version: 'exit-2026-v1', q1: pick(Q1), q2: 1 + Math.floor(Math.random() * 5), q3: pick(Q3), q4: areas, q5: Math.floor(Math.random() * 11), comment: chance(0.3) ? 'Comentario de prueba de carga.' : null };
}

let done = false; // esta persona ya contestó (en este VU)

export function answer(slice, globalUnique = false) {
  const session = studentSession(slice, globalUnique);
  if (!session) return;
  const state = rpc(session, 'my_exit_survey', {});
  if (!state.ok) return think(2, 5);
  if (!ENV.writes) return think(5, 15);
  if (done || state.body.completed) { done = true; return think(10, 30); }
  if (!state.body.is_open) return think(5, 15);

  if (!state.body.invited_at) {
    const claim = rpc(session, 'exit_survey_mark_invited', {});
    if (claim.ok && claim.body.claimed) surveyClaimed.add(1);
  }
  think(8, 40); // lee y contesta las cinco preguntas (~1 minuto reducido)
  const body = payload();
  const sent = rpc(session, 'submit_exit_survey', { p: body });
  if (sent.ok) {
    if (sent.body.saved) surveySaved.add(1); else surveyAlready.add(1);
    done = true;
    if (chance(0.15)) { // reenvío tras «perder la conexión»: debe ser idempotente
      const again = rpc(session, 'submit_exit_survey', { p: payload() }, { op: 'submit_exit_survey', extraTags: { repeat: 'yes' } });
      if (again.ok && again.body.saved) duplicateSaved.add(1);
      if (again.ok && !again.body.already_completed) duplicateSaved.add(1);
      if (again.ok) surveyAlready.add(1);
    }
  }
  think(5, 15);
}

export const handleSummary = summarize('06-survey');
