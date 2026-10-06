// Validación y normalización del formulario público de propuestas de talleres.
// Módulo puro (sin APIs de Deno ni imports externos) para poder probarlo con Node.
// PostgreSQL mantiene sus propios constraints (defensa en profundidad); aquí vive la validación de API/UX.

/** Todos los límites del formulario viven aquí (también se publican en GET para que el frontend los use). */
export const LIMITS = {
  bodyMaxBytes: 32 * 1024,
  facilitatorName: { min: 3, max: 120 },
  facilitatorEmailMax: 254,
  title: { min: 5, max: 150 },
  studentPitch: { min: 20, max: 600 },
  whyJoin: { min: 20, max: 1000 },
  objective: { min: 20, max: 1000 },
  studentExperience: { min: 20, max: 1500 },
  takeaway: { min: 10, max: 600 },
  keywords: { minCount: 3, maxCount: 5, maxLength: 40 },
  capacityPerSession: { min: 1, max: 500 },
  building: { min: 1, max: 100 },
  roomSpace: { min: 1, max: 100 },
  requirementsMax: 1500,
  notesMax: 1500,
} as const;

/** Solo dos categorías. Vida Universitaria engloba liderazgo extracurricular, arte, deporte y similares. */
export const ACTIVITY_TYPES = [
  { value: 'academica', label: 'Taller académico', description: 'Un taller ligado a una o más carreras.' },
  {
    value: 'vida_universitaria',
    label: 'Vida Universitaria',
    description: 'Liderazgo extracurricular, vida universitaria, arte, deporte y experiencias similares.',
  },
] as const;

/** Clasificación exclusiva de Vida Universitaria. Independiente de la división/carrera académica "Liderazgo". */
export const EXPERIENCE_CATEGORIES = [
  { value: 'liderazgo', label: 'Liderazgo' },
  { value: 'deportiva', label: 'Deportiva' },
  { value: 'artistica_cultural', label: 'Artística / cultural' },
  { value: 'vida_universitaria', label: 'Vida universitaria' },
  { value: 'otra', label: 'Otra' },
] as const;

/** Única duración permitida: 30 minutos o 1 hora. */
export const SESSION_DURATIONS = [
  { value: 30, label: '30 minutos' },
  { value: 60, label: '1 hora' },
] as const;

/** Todos los talleres operan en esta ventana. La fija el servidor; el formulario no la pregunta ni la envía. */
export const FIXED_SCHEDULE = { start: '10:00', end: '12:00', breakMinutes: 0 } as const;

/** Única lista blanca de propiedades aceptadas en el POST. */
export const ALLOWED_FIELDS = [
  'facilitator_name',
  'facilitator_email',
  'activity_type',
  'experience_category',
  'title',
  'student_pitch',
  'why_join',
  'objective',
  'student_experience',
  'takeaway',
  'keywords',
  'session_duration_minutes',
  'capacity_per_session',
  'building',
  'room_space',
  'requirements',
  'notes',
  'career_ids',
] as const;

/**
 * Política consistente: cualquier propiedad fuera de ALLOWED_FIELDS (incluidas las administrativas como
 * status, edition_id, reviewed_by, reviewed_at, published_activity_id, admin_notes) RECHAZA el request completo
 * con 400 UNKNOWN_FIELDS. Nunca se ignoran en silencio y nunca llegan a la base de datos.
 */
export const ADMIN_FIELDS = [
  'id',
  'status',
  'edition_id',
  'is_demo',
  'created_at',
  'updated_at',
  'submitted_at',
  'reviewed_at',
  'reviewed_by',
  'admin_notes',
  'published_activity_id',
] as const;

export type FieldError = { field: string; code: string };

export type SubmissionPayload = {
  facilitator_name: string;
  facilitator_email: string;
  activity_type: 'academica' | 'vida_universitaria';
  /** Solo Vida Universitaria; siempre null para académico. */
  experience_category: (typeof EXPERIENCE_CATEGORIES)[number]['value'] | null;
  title: string;
  student_pitch: string;
  why_join: string;
  /** Obligatorio para académico; opcional (null) para Vida Universitaria. */
  objective: string | null;
  student_experience: string;
  takeaway: string;
  keywords: string[];
  session_duration_minutes: number;
  capacity_per_session: number;
  building: string;
  room_space: string;
  requirements: string | null;
  notes: string | null;
  career_ids: string[];
};

export type ValidationResult =
  | { ok: true; value: SubmissionPayload }
  | { ok: false; kind: 'unknown_fields'; fields: string[] }
  | { ok: false; kind: 'invalid'; errors: FieldError[] };

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Una sola línea: sin saltos, whitespace colapsado. */
export function normalizeLine(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Varias líneas: conserva saltos de línea (máximo una línea en blanco seguida), colapsa espacios. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_NEWLINE, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Comparación de keywords sin acentos ni mayúsculas. */
function foldKeyword(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateSubmission(input: unknown): ValidationResult {
  if (!isPlainObject(input)) return { ok: false, kind: 'invalid', errors: [{ field: '$', code: 'INVALID_PAYLOAD' }] };

  const allowed = new Set<string>(ALLOWED_FIELDS);
  const unknown = Object.keys(input).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { ok: false, kind: 'unknown_fields', fields: unknown };

  const errors: FieldError[] = [];
  const err = (field: string, code: string) => errors.push({ field, code });

  const line = (field: string, min: number, max: number): string => {
    const raw = input[field];
    if (typeof raw !== 'string') { err(field, raw === undefined || raw === null ? 'REQUIRED' : 'INVALID_TYPE'); return ''; }
    const v = normalizeLine(raw);
    if (v.length === 0) err(field, 'REQUIRED');
    else if (v.length < min) err(field, 'TOO_SHORT');
    else if (v.length > max) err(field, 'TOO_LONG');
    return v;
  };
  const text = (field: string, min: number, max: number): string => {
    const raw = input[field];
    if (typeof raw !== 'string') { err(field, raw === undefined || raw === null ? 'REQUIRED' : 'INVALID_TYPE'); return ''; }
    const v = normalizeText(raw);
    if (v.length === 0) err(field, 'REQUIRED');
    else if (v.length < min) err(field, 'TOO_SHORT');
    else if (v.length > max) err(field, 'TOO_LONG');
    return v;
  };
  const optionalText = (field: string, max: number): string | null => {
    const raw = input[field];
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') { err(field, 'INVALID_TYPE'); return null; }
    const v = normalizeText(raw);
    if (v.length === 0) return null;
    if (v.length > max) err(field, 'TOO_LONG');
    return v;
  };
  const int = (field: string, min: number, max: number): number => {
    const raw = input[field];
    if (raw === undefined || raw === null) { err(field, 'REQUIRED'); return 0; }
    if (typeof raw !== 'number' || !Number.isInteger(raw)) { err(field, 'INVALID_TYPE'); return 0; }
    if (raw < min) err(field, 'TOO_LOW');
    else if (raw > max) err(field, 'TOO_HIGH');
    return raw;
  };

  // Responsable
  const facilitator_name = line('facilitator_name', LIMITS.facilitatorName.min, LIMITS.facilitatorName.max);
  let facilitator_email = '';
  {
    const raw = input.facilitator_email;
    if (typeof raw !== 'string') err('facilitator_email', raw === undefined || raw === null ? 'REQUIRED' : 'INVALID_TYPE');
    else {
      facilitator_email = normalizeLine(raw).toLowerCase();
      if (facilitator_email.length === 0) err('facilitator_email', 'REQUIRED');
      else if (facilitator_email.length > LIMITS.facilitatorEmailMax || !EMAIL.test(facilitator_email)) err('facilitator_email', 'INVALID_EMAIL');
    }
  }
  // Tipo de taller
  let activity_type: SubmissionPayload['activity_type'] = 'academica';
  {
    const raw = input.activity_type;
    if (typeof raw !== 'string') err('activity_type', raw === undefined || raw === null ? 'REQUIRED' : 'INVALID_TYPE');
    else if (!ACTIVITY_TYPES.some((t) => t.value === raw)) err('activity_type', 'INVALID_ACTIVITY_TYPE');
    else activity_type = raw as SubmissionPayload['activity_type'];
  }

  // Categoría de experiencia: obligatoria solo para Vida Universitaria; prohibida para académico.
  let experience_category: SubmissionPayload['experience_category'] = null;
  {
    const raw = input.experience_category;
    const present = raw !== undefined && raw !== null;
    if (activity_type === 'academica') {
      if (present) err('experience_category', 'NOT_ALLOWED');
    } else if (!present) err('experience_category', 'REQUIRED');
    else if (typeof raw !== 'string') err('experience_category', 'INVALID_TYPE');
    else if (!EXPERIENCE_CATEGORIES.some((c) => c.value === raw)) err('experience_category', 'INVALID_EXPERIENCE_CATEGORY');
    else experience_category = raw as SubmissionPayload['experience_category'];
  }

  // Contenido
  const title = line('title', LIMITS.title.min, LIMITS.title.max);
  const student_pitch = text('student_pitch', LIMITS.studentPitch.min, LIMITS.studentPitch.max);
  const why_join = text('why_join', LIMITS.whyJoin.min, LIMITS.whyJoin.max);
  // El objetivo es obligatorio para académico y opcional para Vida Universitaria (nunca se rellena con textos por defecto).
  const objective =
    activity_type === 'academica'
      ? text('objective', LIMITS.objective.min, LIMITS.objective.max)
      : optionalText('objective', LIMITS.objective.max);
  const student_experience = text('student_experience', LIMITS.studentExperience.min, LIMITS.studentExperience.max);
  const takeaway = text('takeaway', LIMITS.takeaway.min, LIMITS.takeaway.max);

  // Keywords: estructura (arreglo) con 3 a 5 elementos únicos
  const keywords: string[] = [];
  {
    const raw = input.keywords;
    if (raw === undefined || raw === null) err('keywords', 'REQUIRED');
    else if (!Array.isArray(raw)) err('keywords', 'INVALID_TYPE');
    else if (raw.length < LIMITS.keywords.minCount) err('keywords', 'TOO_FEW_KEYWORDS');
    else if (raw.length > LIMITS.keywords.maxCount) err('keywords', 'TOO_MANY_KEYWORDS');
    else {
      const seen = new Set<string>();
      raw.forEach((k, i) => {
        const field = `keywords[${i}]`;
        if (typeof k !== 'string') return err(field, 'INVALID_TYPE');
        const v = normalizeLine(k);
        if (v.length === 0) return err(field, 'EMPTY_KEYWORD');
        if (v.length > LIMITS.keywords.maxLength) return err(field, 'TOO_LONG');
        const folded = foldKeyword(v);
        if (seen.has(folded)) return err(field, 'DUPLICATE_KEYWORD');
        seen.add(folded);
        keywords.push(v);
      });
    }
  }

  // Operación: la duración es una de las opciones permitidas; el horario y el descanso los fija el servidor.
  let session_duration_minutes = 0;
  {
    const raw = input.session_duration_minutes;
    if (raw === undefined || raw === null) err('session_duration_minutes', 'REQUIRED');
    else if (typeof raw !== 'number' || !Number.isInteger(raw)) err('session_duration_minutes', 'INVALID_TYPE');
    else if (!SESSION_DURATIONS.some((d) => d.value === raw)) err('session_duration_minutes', 'INVALID_DURATION');
    else session_duration_minutes = raw;
  }
  const capacity_per_session = int('capacity_per_session', LIMITS.capacityPerSession.min, LIMITS.capacityPerSession.max);

  // Ubicación (edificio y espacio por separado; "Por confirmar" es válido en room_space)
  const building = line('building', LIMITS.building.min, LIMITS.building.max);
  const room_space = line('room_space', LIMITS.roomSpace.min, LIMITS.roomSpace.max);

  // Logística
  const requirements = optionalText('requirements', LIMITS.requirementsMax);
  const notes = optionalText('notes', LIMITS.notesMax);

  // Carreras afines. Académico: una o más (de cualquier división), sin duplicados y sin máximo arbitrario.
  // Vida Universitaria: no se piden; la lista puede venir vacía o ausente.
  const career_ids: string[] = [];
  {
    const raw = input.career_ids;
    const needed = activity_type === 'academica';
    if (raw === undefined || raw === null) { if (needed) err('career_ids', 'CAREERS_REQUIRED'); }
    else if (!Array.isArray(raw)) err('career_ids', 'INVALID_TYPE');
    else if (raw.length === 0) { if (needed) err('career_ids', 'CAREERS_REQUIRED'); }
    else {
      const seen = new Set<string>();
      raw.forEach((c, i) => {
        const field = `career_ids[${i}]`;
        if (typeof c !== 'string' || !UUID.test(c.trim())) return err(field, 'INVALID_CAREER');
        const id = c.trim().toLowerCase();
        if (seen.has(id)) return err(field, 'DUPLICATE_CAREER');
        seen.add(id);
        career_ids.push(id);
      });
    }
  }

  if (errors.length > 0) return { ok: false, kind: 'invalid', errors };

  return {
    ok: true,
    value: {
      facilitator_name,
      facilitator_email,
      activity_type,
      experience_category,
      title,
      student_pitch,
      why_join,
      objective,
      student_experience,
      takeaway,
      keywords,
      session_duration_minutes,
      capacity_per_session,
      building,
      room_space,
      requirements,
      notes,
      career_ids,
    },
  };
}
