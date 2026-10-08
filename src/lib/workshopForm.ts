// Estado, validación y mensajes del asistente de registro de talleres.
// La validación REUTILIZA la de la Edge Function (mismo módulo) para no duplicar reglas: lo que el formulario
// acepta es exactamente lo que el servidor acepta. El servidor y la base de datos siguen siendo la autoridad final.
import {
  ACTIVITY_TYPES,
  EXPERIENCE_CATEGORIES,
  LIMITS,
  SESSION_DURATIONS,
  durationsFor,
  normalizeLine,
  validateSubmission,
  type FieldError,
  type SubmissionPayload,
} from '../../supabase/functions/workshop-intake/validation.ts';
import { IntakeError } from './workshopIntakeApi';

export { ACTIVITY_TYPES, EXPERIENCE_CATEGORIES, LIMITS, SESSION_DURATIONS, durationsFor };

export const ROOM_TBD = 'Por confirmar';

export type FormState = {
  facilitator_name: string;
  facilitator_email: string;
  activity_type: '' | 'academica' | 'vida_universitaria';
  /** Solo Vida Universitaria; se limpia al pasar a académico. */
  experience_category: '' | (typeof EXPERIENCE_CATEGORIES)[number]['value'];
  title: string;
  student_pitch: string;
  objective: string;
  takeaway: string;
  keywords: string[];
  /** '15' solo para Vida Universitaria; el horario 10:00–12:00 lo fija el servidor. */
  session_duration_minutes: string;
  capacity_per_session: string;
  building: string;
  room_space: string;
  room_tbd: boolean;
  requirements: string;
  notes: string;
  career_ids: string[];
};

export const emptyForm = (): FormState => ({
  facilitator_name: '',
  facilitator_email: '',
  activity_type: '',
  experience_category: '',
  title: '',
  student_pitch: '',
  objective: '',
  takeaway: '',
  keywords: [],
  session_duration_minutes: '',
  capacity_per_session: '',
  building: '',
  room_space: '',
  room_tbd: false,
  requirements: '',
  notes: '',
  career_ids: [],
});

export type StepDef = { id: string; title: string; short: string; fields: readonly string[] };

/** Todos los pasos posibles, en lenguaje natural. El último (revisión) valida todo el formulario. */
export const STEPS: readonly StepDef[] = [
  { id: 'responsable', title: 'Tus datos', short: 'Tus datos', fields: ['facilitator_name', 'facilitator_email'] },
  { id: 'taller', title: 'Tu taller', short: 'Taller', fields: ['activity_type', 'experience_category', 'title', 'student_pitch'] },
  {
    id: 'experiencia',
    title: 'Experiencia del alumno',
    short: 'Experiencia',
    fields: ['objective', 'takeaway', 'keywords'],
  },
  {
    id: 'operacion',
    title: 'Logística',
    short: 'Logística',
    fields: ['session_duration_minutes', 'capacity_per_session', 'building', 'room_space', 'requirements', 'notes'],
  },
  { id: 'carreras', title: 'Carreras relacionadas', short: 'Carreras', fields: ['career_ids'] },
  { id: 'revision', title: 'Revisa y envía', short: 'Revisión', fields: [] },
];

/** Vida Universitaria no se relaciona con carreras: ese paso se omite. */
export const needsCareers = (type: FormState['activity_type']) => type !== 'vida_universitaria';

/** Pasos visibles según el tipo de taller (con tipo aún sin elegir se asume el flujo académico). */
export const stepsFor = (type: FormState['activity_type']): readonly StepDef[] =>
  type === 'vida_universitaria'
    ? STEPS.filter((s) => s.id !== 'carreras').map((s) =>
        s.id === 'taller' ? { ...s, title: 'Tu actividad', short: 'Actividad' } : s.id === 'experiencia' ? { ...s, title: 'Experiencia' } : s,
      )
    : STEPS;

export type FieldCopy = { label: string; hint?: string };
export type TypeCopy = Record<'title' | 'student_pitch' | 'objective' | 'takeaway', FieldCopy>;

/** Lenguaje de cada pregunta según el tipo. Las columnas son las mismas; solo cambia el copy visible. */
export const copyFor = (type: FormState['activity_type']): TypeCopy =>
  type === 'vida_universitaria'
    ? {
        title: { label: 'Nombre de la actividad' },
        student_pitch: { label: 'Descripción corta', hint: 'En pocas palabras, ¿qué experiencia vivirán los alumnos?' },
        objective: {
          label: '¿Qué buscas generar con esta experiencia?',
          hint: 'Por ejemplo: integración, creatividad, liderazgo, bienestar, convivencia o diversión.',
        },
        takeaway: { label: '¿Con qué queremos que se queden después de participar?', hint: 'Puede ser una sensación, una experiencia, una habilidad o una integración.' },
      }
    : {
        title: { label: 'Nombre del taller' },
        student_pitch: { label: 'Presenta tu taller en pocas palabras', hint: 'Es lo primero que verán los alumnos al elegirlo.' },
        objective: { label: '¿Cuál es el objetivo del taller?', hint: 'Qué quieres que el alumno comprenda, descubra o experimente.' },
        takeaway: { label: '¿Qué aprendizaje o idea quieres que se lleve?' },
      };

export const fieldId = (field: string) => `wf-${field}`;

/** Construye el borrador que entiende `validateSubmission` a partir del estado del formulario. */
export function buildDraft(f: FormState): Record<string, unknown> {
  const num = (v: string): number | string | undefined => {
    const t = v.trim();
    if (t === '') return undefined;
    return /^-?\d+$/.test(t) ? Number(t) : t;
  };
  const orNull = (v: string) => (v.trim() === '' ? null : v);
  return {
    facilitator_name: f.facilitator_name,
    facilitator_email: f.facilitator_email,
    activity_type: f.activity_type || undefined,
    // La categoría solo existe para Vida Universitaria; nunca se mezcla con un taller académico.
    experience_category: f.activity_type === 'vida_universitaria' ? f.experience_category || undefined : undefined,
    title: f.title,
    student_pitch: f.student_pitch,
    // Opcional en Vida Universitaria (vacío → null); obligatorio en académico.
    objective: f.activity_type === 'vida_universitaria' ? orNull(f.objective) : f.objective,
    takeaway: f.takeaway,
    keywords: f.keywords,
    session_duration_minutes: num(f.session_duration_minutes),
    capacity_per_session: num(f.capacity_per_session),
    building: f.building,
    room_space: f.room_tbd ? ROOM_TBD : f.room_space,
    requirements: orNull(f.requirements),
    notes: orNull(f.notes),
    // Vida Universitaria no pide carreras: siempre viaja vacío aunque antes se hubiera marcado alguna.
    career_ids: needsCareers(f.activity_type) ? f.career_ids : [],
  };
}

const baseField = (field: string) => field.replace(/\[\d+\]$/, '');

const range = (min: number, max: number) => `entre ${min} y ${max}`;
const LENGTHS: Record<string, { min: number; max: number }> = {
  facilitator_name: LIMITS.facilitatorName,
  title: LIMITS.title,
  student_pitch: LIMITS.studentPitch,
  objective: LIMITS.objective,
  takeaway: LIMITS.takeaway,
  building: LIMITS.building,
  room_space: LIMITS.roomSpace,
  requirements: { min: 0, max: LIMITS.requirementsMax },
  notes: { min: 0, max: LIMITS.notesMax },
};
const NUMBERS: Record<string, { min: number; max: number }> = {
  capacity_per_session: LIMITS.capacityPerSession,
};

/** Mensaje en lenguaje natural para un código de validación (de la Edge Function o de este formulario). */
export function messageFor(field: string, code: string): string {
  const f = baseField(field);
  switch (code) {
    case 'REQUIRED':
      return 'Este dato es obligatorio.';
    case 'INVALID_TYPE':
      return NUMBERS[f] ? 'Escribe solo un número entero.' : 'Revisa este dato.';
    case 'TOO_SHORT':
      return `Escribe un poco más (mínimo ${LENGTHS[f]?.min ?? 3} caracteres).`;
    case 'TOO_LONG':
      return f === 'keywords'
        ? `Cada palabra clave puede tener hasta ${LIMITS.keywords.maxLength} caracteres.`
        : `Es demasiado largo (máximo ${LENGTHS[f]?.max ?? 1000} caracteres).`;
    case 'INVALID_EMAIL':
      return 'Escribe un correo válido, por ejemplo nombre@dominio.com.';
    case 'INVALID_ACTIVITY_TYPE':
      return 'Elige el tipo de taller.';
    case 'INVALID_EXPERIENCE_CATEGORY':
      return 'Elige la categoría de la experiencia.';
    case 'NOT_ALLOWED':
      return 'Este dato no aplica para este tipo de taller.';
    case 'INVALID_DURATION':
      return 'Elige una duración válida para este tipo de taller.';
    case 'TOO_FEW_KEYWORDS':
      return `Agrega al menos ${LIMITS.keywords.minCount} palabras clave.`;
    case 'TOO_MANY_KEYWORDS':
      return `Puedes agregar hasta ${LIMITS.keywords.maxCount} palabras clave.`;
    case 'EMPTY_KEYWORD':
      return 'Hay una palabra clave vacía.';
    case 'DUPLICATE_KEYWORD':
      return 'Hay palabras clave repetidas (aunque cambien mayúsculas o acentos).';
    case 'TOO_LOW':
    case 'TOO_HIGH':
      return NUMBERS[f] ? `Debe estar ${range(NUMBERS[f].min, NUMBERS[f].max)}.` : 'El valor está fuera de rango.';
    case 'CAREERS_REQUIRED':
      return 'Elige al menos una carrera relacionada.';
    case 'INVALID_CAREER':
      return 'Alguna de las carreras elegidas ya no está disponible.';
    case 'DUPLICATE_CAREER':
      return 'Hay carreras repetidas.';
    default:
      return 'Revisa este dato.';
  }
}

export type FieldErrors = Record<string, string>;

function collect(errors: FieldError[]): FieldErrors {
  const out: FieldErrors = {};
  for (const e of errors) {
    const key = baseField(e.field);
    if (!(key in out)) out[key] = messageFor(e.field, e.code);
  }
  return out;
}

/** Valida todo el formulario; devuelve errores por campo (vacío = válido) y, si es válido, el payload final. */
export function validateForm(f: FormState): { errors: FieldErrors; payload: SubmissionPayload | null } {
  const result = validateSubmission(buildDraft(f));
  if (result.ok) return { errors: {}, payload: result.value };
  if (result.kind === 'unknown_fields') return { errors: { _form: 'Hay datos que no reconocemos. Recarga la página.' }, payload: null };
  return { errors: collect(result.errors), payload: null };
}

/** Errores de un paso concreto (por id). La revisión (último paso) valida todo. */
export function validateStep(f: FormState, stepId: string): FieldErrors {
  const { errors } = validateForm(f);
  const step = STEPS.find((s) => s.id === stepId);
  if (!step || step.fields.length === 0) return errors;
  const out: FieldErrors = {};
  for (const field of step.fields) if (errors[field]) out[field] = errors[field];
  return out;
}

/** Id del paso al que pertenece un campo (undefined si no pertenece a ninguno). */
export const stepIdOfField = (field: string): string | undefined => STEPS.find((s) => s.fields.includes(baseField(field)))?.id;

/** Carreras sin acentos ni mayúsculas, para el filtro de búsqueda. */
export const foldSearch = (s: string) => normalizeLine(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type SubmitFailure = {
  message: string;
  fieldErrors: FieldErrors;
  /** El catálogo cambió: conviene recargarlo. */
  reloadCatalog?: boolean;
  /** El registro no está disponible (sin edición activa). */
  unavailable?: boolean;
};

/** Traduce los códigos del backend a mensajes humanos. Nunca muestra SQL, constraints ni detalles internos. */
export function describeSubmitError(err: unknown): SubmitFailure {
  if (!(err instanceof IntakeError)) return { message: 'Ocurrió un problema inesperado. Inténtalo de nuevo en unos minutos.', fieldErrors: {} };
  if (err.kind === 'network') {
    return { message: 'No pudimos conectarnos. Revisa tu conexión a internet e inténtalo de nuevo.', fieldErrors: {} };
  }
  switch (err.code) {
    case 'VALIDATION_FAILED':
      return { message: 'Revisa los campos marcados: hay datos que debemos corregir.', fieldErrors: collect(err.fieldErrors) };
    case 'NO_ACTIVE_EDITION':
      return { message: 'El registro aún no está disponible. Vuelve a intentarlo más tarde.', fieldErrors: {}, unavailable: true };
    case 'INVALID_CAREER':
    case 'CATALOG_MISMATCH':
    case 'DUPLICATE_CAREER':
    case 'CAREERS_REQUIRED':
      return {
        message: 'El catálogo de carreras se actualizó. Recarga las opciones y vuelve a elegir.',
        fieldErrors: {},
        reloadCatalog: true,
      };
    case 'UNKNOWN_FIELDS':
    case 'INVALID_PAYLOAD':
      return { message: 'Esta página está desactualizada. Recárgala e inténtalo de nuevo.', fieldErrors: {} };
    case 'PAYLOAD_TOO_LARGE':
      return { message: 'El contenido es demasiado extenso. Acorta los textos e inténtalo de nuevo.', fieldErrors: {} };
    default:
      return { message: 'Ocurrió un problema de nuestro lado. Inténtalo de nuevo en unos minutos.', fieldErrors: {} };
  }
}
