import { rpc } from './adminApi';
import { EVENT_TIME_ZONE, formatEventTime } from './eventTime';

/*
 * Encuesta de salida del Día OV 2026: preguntas, envío y estado.
 *
 * Todo lo que importa lo decide el SERVIDOR (supabase/migrations/20261014140000_exit_survey_raffle_requirement.sql): la hora de
 * apertura, si la persona ya contestó, si sus sellos alcanzan una categoría y si por eso participa en el sorteo. Este módulo solo
 * define el cuestionario que se muestra, valida lo mínimo para no mandar un formulario incompleto y traduce las respuestas.
 */

/** Versión de las preguntas que muestra esta pantalla; el servidor rechaza una versión distinta (pantalla desactualizada). */
export const EXIT_SURVEY_VERSION = 'exit-2026-v1';

export type Option<T extends string = string> = { value: T; label: string };

export const Q1_OPTIONS: Option[] = [
  { value: 'tenia_carrera', label: 'Sí, tenía una carrera elegida' },
  { value: 'entre_varias', label: 'Estaba entre varias opciones' },
  { value: 'area_sin_carrera', label: 'Tenía un área de interés, pero no una carrera' },
  { value: 'sin_idea', label: 'Todavía no tenía idea' },
];

export const Q3_OPTIONS: Option[] = [
  { value: 'ya_claro', label: 'Ya lo tengo claro' },
  { value: 'algunas_opciones', label: 'Tengo algunas opciones' },
  { value: 'descubri_area', label: 'Descubrí un área de interés' },
  { value: 'seguir_explorando', label: 'Quiero seguir explorando' },
];

/** Las áreas de la encuesta institucional original. «ninguna» es exclusiva: seguir sin un área definida es una respuesta válida. */
export const NO_AREA = 'ninguna';
export const AREA_OPTIONS: Option[] = [
  { value: 'salud', label: 'Salud' },
  { value: 'deporte', label: 'Deporte' },
  { value: 'negocios', label: 'Negocios' },
  { value: 'derecho_ri', label: 'Derecho y Relaciones Internacionales' },
  { value: 'liderazgo', label: 'Liderazgo' },
  { value: 'arquitectura_diseno', label: 'Arquitectura y Diseño' },
  { value: 'ingenierias', label: 'Ingenierías' },
  { value: 'comunicacion_creativas', label: 'Comunicación y áreas creativas' },
];
export const MAX_AREAS = 3;
export const COMMENT_MAX = 500;

export type SurveyAnswers = {
  q1: string | null;
  q2: number | null;
  q3: string | null;
  q4: string[];
  q5: number | null;
  comment: string;
};

export const EMPTY_ANSWERS: SurveyAnswers = { q1: null, q2: null, q3: null, q4: [], q5: null, comment: '' };

export const QUESTION_COUNT = 5;

/** ¿Está respondida la pregunta `index` (0–4)? El comentario es opcional y no cuenta. */
export function answered(answers: SurveyAnswers, index: number): boolean {
  switch (index) {
    case 0: return Q1_OPTIONS.some((option) => option.value === answers.q1);
    case 1: return Number.isInteger(answers.q2) && answers.q2! >= 1 && answers.q2! <= 5;
    case 2: return Q3_OPTIONS.some((option) => option.value === answers.q3);
    case 3: return answers.q4.length >= 1 && answers.q4.length <= MAX_AREAS;
    case 4: return Number.isInteger(answers.q5) && answers.q5! >= 0 && answers.q5! <= 10;
    default: return false;
  }
}

export const isComplete = (answers: SurveyAnswers) => Array.from({ length: QUESTION_COUNT }, (_, index) => answered(answers, index)).every(Boolean);

/** Alterna un área respetando el máximo de tres y la exclusividad de «todavía sin un área definida». */
export function toggleArea(current: string[], value: string): string[] {
  if (value === NO_AREA) return current.includes(NO_AREA) ? [] : [NO_AREA];
  const without = current.filter((area) => area !== NO_AREA);
  if (without.includes(value)) return without.filter((area) => area !== value);
  return without.length >= MAX_AREAS ? without : [...without, value];
}

/** Lo que se manda al servidor. Nunca lleva identificador de persona: el servidor usa la sesión. */
export function toPayload(answers: SurveyAnswers) {
  const comment = answers.comment.trim();
  return { version: EXIT_SURVEY_VERSION, q1: answers.q1, q2: answers.q2, q3: answers.q3, q4: answers.q4, q5: answers.q5, comment: comment || null };
}

export type ExitSurveyStatus = {
  version: string;
  /** Hora de apertura (ISO). */
  opensAt: string;
  /** Diferencia entre el reloj del servidor y el de este dispositivo al recibir la respuesta (ms): sirve para no fiarse del reloj local. */
  offsetMs: number;
  isOpen: boolean;
  completed: boolean;
  completedAt: string | null;
  /** Ya se le mostró la invitación automática (guardado en el servidor, vale para todos sus dispositivos). */
  invitedAt: string | null;
  hasWon: boolean;
  /** Categoría alcanzada por sellos (no implica que participe: falta la encuesta). */
  stampsCategoryName: string | null;
  stampsMet: boolean;
  /** Sellos de una categoría Y encuesta completada. */
  eligible: boolean;
};

export type ExitSurveyOutcome = ExitSurveyStatus & { saved: boolean; alreadyCompleted: boolean };

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Convierte la respuesta del servidor. `receivedAt` es el reloj de este dispositivo en el momento de recibirla. */
export function normalizeExitSurvey(raw: Record<string, unknown> | null | undefined, receivedAt: number = Date.now()): ExitSurveyStatus {
  const r = raw ?? {};
  const serverNow = typeof r.server_now === 'string' ? Date.parse(r.server_now) : Number.NaN;
  return {
    version: text(r.version) ?? EXIT_SURVEY_VERSION,
    opensAt: text(r.opens_at) ?? '',
    offsetMs: Number.isFinite(serverNow) ? serverNow - receivedAt : 0,
    isOpen: r.is_open === true,
    completed: r.completed === true,
    completedAt: text(r.completed_at),
    invitedAt: text(r.invited_at),
    hasWon: r.has_won === true,
    stampsCategoryName: text(r.stamps_category_name),
    stampsMet: r.stamps_met === true,
    eligible: r.eligible === true,
  };
}

/** Milisegundos que faltan para la apertura según el reloj del SERVIDOR (≤ 0 = ya es la hora). `null` si no hay hora. */
export function msUntilOpen(status: Pick<ExitSurveyStatus, 'opensAt' | 'offsetMs'>, now: number = Date.now()): number | null {
  const opens = Date.parse(status.opensAt);
  return Number.isFinite(opens) ? opens - (now + status.offsetMs) : null;
}

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: EVENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLong = new Intl.DateTimeFormat('es-MX', { timeZone: EVENT_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const DAY_MS = 24 * 3_600_000;

/**
 * Cuándo abre, en palabras y en hora de Cancún (nunca la del dispositivo): «hoy a las 1:00 p.m.», «mañana a las 2:30 p.m.» o «el
 * viernes 16 de octubre a las 2:30 p.m.». «Hoy» y «mañana» se miden contra el día de Cancún según el reloj del SERVIDOR, así que
 * respetan cualquier cambio de hora que haga Coordinación (otro día, otra hora) y un dispositivo mal configurado no los altera.
 */
export function describeOpening(status: Pick<ExitSurveyStatus, 'opensAt' | 'offsetMs'>, now: number = Date.now()): string {
  const opens = Date.parse(status.opensAt);
  if (!Number.isFinite(opens)) return '';
  const time = formatEventTime(status.opensAt);
  const today = dayKey.format(now + status.offsetMs);
  const day = dayKey.format(opens);
  if (day === today) return `hoy a las ${time}`;
  if (day === dayKey.format(now + status.offsetMs + DAY_MS)) return `mañana a las ${time}`;
  return `el ${dayLong.format(opens)} a las ${time}`;
}

/**
 * Una llamada a Supabase que no llegó (sin conexión, tiempo agotado, puerta de enlace saturada) no es un error de las respuestas: se
 * nombra como temporal para que la pantalla conserve lo escrito y ofrezca reintentar. Los códigos de negocio pasan sin cambios.
 */
export function asSurveyError(cause: unknown): unknown {
  const message = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : typeof cause === 'string' ? cause : '';
  if (/failed to fetch|fetch failed|network|load failed|networkerror|ECONN|offline/i.test(message)) return new Error('NETWORK');
  if (/time(d)? ?out|abort/i.test(message)) return new Error('TIMEOUT');
  if (/429|too many|rate.?limit/i.test(message)) return new Error('RATE_LIMITED');
  if (/\b5\d\d\b|bad gateway|service unavailable|gateway time/i.test(message)) return new Error('TEMPORARILY_UNAVAILABLE');
  return cause;
}

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await rpc<T>(name, args);
  } catch (cause) {
    throw asSurveyError(cause);
  }
}

export async function fetchMyExitSurvey(): Promise<ExitSurveyStatus> {
  const raw = await call<Record<string, unknown>>('my_exit_survey');
  return normalizeExitSurvey(raw, Date.now());
}

/** Reparte la consulta de apertura entre los teléfonos: miles de alumnos no preguntan en el mismo segundo. */
export const OPEN_JITTER_MS = 30_000;
/** Mientras falta mucho para la hora se vuelve a consultar cada tanto, por si cambió la hora o el reloj del dispositivo. */
export const RESYNC_MS = 10 * 60_000;
export const MAX_FAILURE_BACKOFF_MS = 5 * 60_000;

/**
 * ¿Cuándo volver a preguntar al servidor? `null` = nada que esperar (ya contestó, o ya está abierta y solo falta que responda: eso lo
 * mueve la persona). Nunca depende solo del reloj del dispositivo: se corrige con la diferencia con el servidor y, aun así, se
 * confirma con el servidor cuando llega la hora y al volver a la pantalla / recuperar la conexión (eso lo hace el proveedor).
 */
export function nextCheckDelay(status: ExitSurveyStatus | null, failures: number, now: number = Date.now(), random: () => number = Math.random): number | null {
  if (status?.completed) return null;
  if (!status) return Math.round(Math.min(MAX_FAILURE_BACKOFF_MS, 15_000 * 2 ** Math.min(failures, 5)) * (0.85 + random() * 0.3));
  if (status.isOpen) return null;
  const remaining = msUntilOpen(status, now);
  if (remaining === null) return RESYNC_MS;
  // Según el reloj corregido ya es la hora pero el servidor aún dice que no (cambiaron la hora, o hay desfase): se revisa pronto.
  if (remaining <= 0) return Math.round(45_000 + random() * 45_000);
  return Math.round(Math.min(remaining + random() * OPEN_JITTER_MS, RESYNC_MS));
}

/**
 * Reclama, de forma atómica en el servidor, el derecho a mostrar la invitación automática. `claimed` es `true` para UNA sola solicitud
 * en toda la vida de la persona: solo el dispositivo que lo obtiene abre el popup; los demás conservan el acceso desde la Bitácora.
 * Un fallo de conexión se lanza (no se sabe si se obtuvo): el popup no se abre sin la confirmación del servidor.
 */
export async function claimExitSurveyInvitation(): Promise<{ status: ExitSurveyStatus; claimed: boolean }> {
  const raw = await call<Record<string, unknown>>('exit_survey_mark_invited');
  return { status: normalizeExitSurvey(raw, Date.now()), claimed: raw?.claimed === true };
}

/**
 * Guarda la encuesta de la persona autenticada. Es idempotente en el servidor: reenviar tras perder la conexión, un doble clic o un
 * segundo dispositivo no duplican ni sobrescriben; responde con el estado actual (`alreadyCompleted`).
 */
export async function submitExitSurvey(answers: SurveyAnswers): Promise<ExitSurveyOutcome> {
  const raw = await call<Record<string, unknown>>('submit_exit_survey', { p: toPayload(answers) });
  return { ...normalizeExitSurvey(raw), saved: raw?.saved === true, alreadyCompleted: raw?.already_completed === true };
}

// ── Coordinación ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SurveyAggregate = {
  completed: number;
  participants: number;
  q1: Record<string, number>;
  q2_rating: Record<string, number>;
  q2_average: number | null;
  q3: Record<string, number>;
  q4: Record<string, number>;
  q5_average: number | null;
  q5_promoters: number;
  q5_passives: number;
  q5_detractors: number;
  comments: { text: string; completed_at: string }[];
};

export type ExitSurveyAdmin = {
  version: string;
  opens_at: string;
  custom: boolean;
  default_opens_at: string;
  timezone: string;
  server_now: string;
  mode: string;
  official: SurveyAggregate;
  rehearsal: SurveyAggregate;
};

export const fetchExitSurveyAdmin = () => rpc<ExitSurveyAdmin>('exit_survey_admin');
/** `null` restablece la hora por omisión (día del evento, 13:00 de Cancún). */
export const setExitSurveyOpensAt = (opensAt: string | null) => rpc<{ opens_at: string; custom: boolean }>('set_exit_survey_opens_at', { p_opens_at: opensAt });

/** Net Promoter Score (−100…100) a partir de los conteos; `null` sin respuestas. */
export function nps(aggregate: Pick<SurveyAggregate, 'completed' | 'q5_promoters' | 'q5_detractors'>): number | null {
  return aggregate.completed > 0 ? Math.round(((aggregate.q5_promoters - aggregate.q5_detractors) / aggregate.completed) * 100) : null;
}
