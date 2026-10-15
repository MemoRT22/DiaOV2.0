import { ENV, staticVuCap } from '../lib/env.js';
import { allocateFullDay, authPlan } from '../lib/planning.js';

/*
 * Perfiles de carga. Cada perfil describe la CONCURRENCIA de personas (usuarios virtuales = personas con sesión abierta) y, para el
 * inicio de sesión, la TASA DE LLEGADA. Se escalan con SCALE (0–1) y se topan con MAX_VUS para correr una versión reducida en una
 * computadora. Ninguno envía escrituras si LOADTEST_ALLOW_WRITES no tiene la frase exacta.
 *
 *   smoke     validar que todo funciona (minutos, pocos usuarios)
 *   baseline  «pruebas iniciales»: carga ligera para tener una línea base
 *   normal    un día de evento típico: ~600 personas simultáneas, llegada gradual
 *   stress    escalones hasta 2,000 simultáneas y más allá de lo esperado, para encontrar el punto de quiebre
 *   peak2000  pico: las 2,000 personas conectadas a la vez tras una llegada gradual
 *   spike     arranque brusco: 0→2,000 en un minuto (p. ej. apertura de reservaciones 07:00)
 *   soak      resistencia: carga moderada sostenida una hora (fugas, degradación lenta)
 */
const min = (n) => `${n}m`;
const sec = (n) => `${n}s`;

/** Etapas de concurrencia [duración, objetivo] por perfil. */
export const VUS_STAGES = {
  smoke: [[sec(30), 3], [min(1), 5], [sec(30), 0]],
  baseline: [[min(2), 50], [min(5), 50], [min(1), 0]],
  normal: [[min(5), 600], [min(15), 600], [min(2), 0]],
  stress: [[min(2), 400], [min(3), 400], [min(2), 800], [min(3), 800], [min(2), 1200], [min(3), 1200], [min(2), 1600], [min(3), 1600], [min(2), 2000], [min(5), 2000], [min(2), 0]],
  peak2000: [[min(8), 2000], [min(10), 2000], [min(3), 0]],
  spike: [[sec(60), 2000], [min(5), 2000], [min(1), 0]],
  soak: [[min(5), 400], [min(60), 400], [min(2), 0]],
};

/** El volumen exacto de Auth y su ventana gradual viven en planning.js para poder probarlos fuera de k6. */
export const PROFILES = Object.keys(VUS_STAGES);

const scaleTarget = (target) => (target === 0 ? 0 : Math.max(1, Math.min(ENV.maxVus, Math.round(target * ENV.scale))));
const profileName = () => { if (!VUS_STAGES[ENV.profile]) throw new Error(`[loadtest] PROFILE desconocido «${ENV.profile}». Opciones: ${PROFILES.join(', ')}`); return ENV.profile; };

/** Concurrencia de personas con sesión abierta (cada VU = una persona que repite su recorrido). */
export function journey({ exec, startTime = '0s', tags = {}, share = 1, fullDayFlow }) {
  const profile = profileName();
  return {
    executor: 'ramping-vus', exec, startTime, tags, gracefulRampDown: '30s', gracefulStop: '30s',
    startVUs: 0,
    stages: VUS_STAGES[profile].map(([duration, target]) => {
      const scaled = scaleTarget(target);
      const allocated = fullDayFlow ? allocateFullDay(scaled, profile)[fullDayFlow] : Math.round(scaled * share);
      return { duration, target: Math.min(ENV.maxVus, allocated) };
    }),
  };
}

/** Volumen EXACTO de accesos. Cada VU ejecuta una sola iteración y espera su instante dentro de la ventana gradual. */
export function authArrivals({ exec, startTime = '0s', tags = {} }) {
  const plan = authPlan(profileName(), ENV.scale, ENV.maxVus);
  return {
    executor: 'per-vu-iterations', exec, startTime, tags, vus: plan.users, iterations: 1,
    maxDuration: `${plan.windowSeconds + 300}s`, gracefulStop: '30s',
  };
}

/** Carga estática: tasa de páginas por segundo, topada si no hay autorización escrita de terceros. */
export function statics({ exec, startTime = '0s', tags = {} }) {
  const stages = VUS_STAGES[profileName()].map(([duration, target]) => ({ duration, target: staticVuCap(Math.min(ENV.maxVus, scaleTarget(target))) }));
  return { executor: 'ramping-vus', exec, startTime, tags, gracefulRampDown: '30s', startVUs: 0, stages };
}

/** Duración total del perfil, útil para escalonar escenarios dentro de una misma ejecución. */
export function totalSeconds() {
  const toSec = (value) => (value.endsWith('m') ? Number(value.slice(0, -1)) * 60 : Number(value.slice(0, -1)));
  return VUS_STAGES[profileName()].reduce((sum, [duration]) => sum + toSec(duration), 0);
}
