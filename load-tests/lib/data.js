import { SharedArray } from 'k6/data';
import { ENV } from './env.js';

// Los datos FICTICIOS los genera `tools/generate-data.mjs` y se cargan una sola vez en memoria compartida (no una copia por VU).
const users = new SharedArray('users', () => JSON.parse(open(`${ENV.dataDir}/users.json`)));
const manifest = new SharedArray('manifest', () => [JSON.parse(open(`${ENV.dataDir}/manifest.json`))]);

export const dataset = () => manifest[0];
export const userCount = () => users.length;
export const userAt = (index) => users[index % users.length];

/** Reparto del padrón entre escenarios cuando corren juntos (`99-full-day`): { base, size } sobre el padrón completo. */
export const cohort = (name) => dataset().cohorts[name];

/**
 * Cada usuario virtual es una PERSONA distinta con su propia cuenta: nunca una cuenta compartida. `slice` reparte el padrón entre
 * escenarios de una misma ejecución para que no se pisen: { base, size } sobre el padrón completo.
 */
export function userFor(index, slice) {
  const base = slice ? slice.base : 0;
  const size = slice ? slice.size : users.length;
  if (size > users.length) throw new Error(`[loadtest] El escenario necesita ${size} usuarios y el padrón ficticio tiene ${users.length}. Genera más con tools/generate-data.mjs --users N.`);
  return users[(base + (index % size)) % users.length]; // más personas que cuentas en el reparto: se reutilizan por turnos, nunca una sola cuenta para todos
}

export const sessionsOf = (set) => dataset().sessions.filter((session) => session.set === set);
export const credentialOf = (activityId) => dataset().credentials.find((credential) => credential.activity_id === activityId);
export const bookingsOf = (userIndex) => dataset().bookings[String(userIndex)] || [];
