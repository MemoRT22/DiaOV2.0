import { describe, expect, it } from 'vitest';
import { IntakeError } from './workshopIntakeApi';
import {
  buildDraft,
  copyFor,
  describeSubmitError,
  emptyForm,
  messageFor,
  stepIdOfField,
  stepsFor,
  validateForm,
  validateStep,
  type FormState,
} from './workshopForm';

const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const valid = (over: Partial<FormState> = {}): FormState => ({
  ...emptyForm(),
  facilitator_name: 'Ana Pérez',
  facilitator_email: 'Ana@Example.com',
  activity_type: 'academica',
  title: 'Código Rojo Cancún 2035',
  student_pitch: 'Resuelve una crisis digital en equipo durante una hora.',
  objective: 'Que el alumno identifique el rol de las TI en una emergencia.',
  takeaway: 'Una idea clara de qué hace un ingeniero en ciberseguridad.',
  keywords: ['ciberseguridad', 'inteligencia artificial', 'simulación'],
  session_duration_minutes: '60',
  capacity_per_session: '30',
  building: 'Edificio A',
  room_tbd: true,
  career_ids: [C1, C2],
  ...over,
});

describe('validateForm (misma validación que la Edge Function)', () => {
  it('acepta un formulario completo y normaliza', () => {
    const { errors, payload } = validateForm(valid());
    expect(errors).toEqual({});
    expect(payload?.facilitator_email).toBe('ana@example.com');
    expect(payload?.room_space).toBe('Por confirmar');
    expect(payload?.career_ids).toEqual([C1, C2]);
    expect(payload?.session_duration_minutes).toBe(60);
  });

  it('el payload ya no incluye teléfono, división, horario ni descanso', () => {
    const { payload } = validateForm(valid());
    for (const retired of ['facilitator_phone', 'division_id', 'operating_start_time', 'operating_end_time', 'break_minutes']) {
      expect(payload).not.toHaveProperty(retired);
    }
    expect(Object.keys(buildDraft(valid())).sort()).toEqual([
      'activity_type', 'building', 'capacity_per_session', 'career_ids', 'experience_category', 'facilitator_email', 'facilitator_name', 'keywords', 'notes', 'objective', 'requirements', 'room_space', 'session_duration_minutes', 'student_pitch', 'takeaway', 'title'
    ]);
  });

  it('keywords: mínimo, máximo y repetidas sin acentos ni mayúsculas', () => {
    expect(validateForm(valid({ keywords: ['a1', 'b2'] })).errors.keywords).toMatch(/al menos 3/);
    expect(validateForm(valid({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] })).errors.keywords).toMatch(/hasta 5/);
    expect(validateForm(valid({ keywords: ['Simulación', 'simulacion', 'x'] })).errors.keywords).toMatch(/repetidas/);
    expect(validateForm(valid({ keywords: ['Año', 'ANO', 'x'] })).errors.keywords).toMatch(/repetidas/);
  });

  it('campos obligatorios, correo y cupo', () => {
    const e = validateForm(emptyForm()).errors;
    expect(e.facilitator_name).toBe('Este dato es obligatorio.');
    expect(e.activity_type).toBeTruthy();
    expect(e.session_duration_minutes).toBeTruthy();
    expect(e.career_ids).toMatch(/al menos una carrera/);
    expect(e).not.toHaveProperty('division_id');
    expect(e).not.toHaveProperty('facilitator_phone');
    expect(validateForm(valid({ facilitator_email: 'sin-arroba' })).errors.facilitator_email).toMatch(/correo válido/);
    expect(validateForm(valid({ capacity_per_session: '0' })).errors.capacity_per_session).toMatch(/entre 1 y 500/);
    expect(validateForm(valid({ capacity_per_session: 'abc' })).errors.capacity_per_session).toMatch(/número entero/);
  });

  it('la duración solo admite 30 minutos o 1 hora', () => {
    expect(validateForm(valid({ session_duration_minutes: '30' })).errors.session_duration_minutes).toBeUndefined();
    expect(validateForm(valid({ session_duration_minutes: '60' })).errors.session_duration_minutes).toBeUndefined();
    for (const bad of ['', '0', '15', '45', '90', '120', 'abc', '60.5']) {
      expect(validateForm(valid({ session_duration_minutes: bad })).errors.session_duration_minutes, bad).toBeTruthy();
    }
    expect(validateForm(valid({ session_duration_minutes: '45' })).errors.session_duration_minutes).toBe('Elige 30 minutos o 1 hora.');
  });

  it('el espacio puede quedar «Por confirmar»; sin marcar, es obligatorio', () => {
    expect(validateForm(valid({ room_tbd: true, room_space: '' })).errors.room_space).toBeUndefined();
    expect(validateForm(valid({ room_tbd: false, room_space: '' })).errors.room_space).toBeTruthy();
  });

  it('académico: una o varias carreras, sin tope; cero carreras se rechaza', () => {
    expect(validateForm(valid({ career_ids: [] })).errors.career_ids).toMatch(/al menos una carrera/);
    expect(validateForm(valid({ career_ids: [C1] })).errors.career_ids).toBeUndefined();
    const many = Array.from({ length: 35 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const { errors, payload } = validateForm(valid({ career_ids: many }));
    expect(errors.career_ids).toBeUndefined();
    expect(payload?.career_ids).toHaveLength(35);
  });

  it('Vida Universitaria: sin carreras es válido y el tipo viaja correcto', () => {
    const { errors, payload } = validateForm(valid({ activity_type: 'vida_universitaria', experience_category: 'otra', career_ids: [] }));
    expect(errors).toEqual({});
    expect(payload?.activity_type).toBe('vida_universitaria');
    expect(payload?.career_ids).toEqual([]);
  });

  it('Vida Universitaria nunca envía carreras, aunque antes se hubieran marcado', () => {
    const { errors, payload } = validateForm(valid({ activity_type: 'vida_universitaria', experience_category: 'otra', career_ids: [C1, C2] }));
    expect(errors).toEqual({});
    expect(payload?.career_ids).toEqual([]);
  });

  it('categoría de experiencia: obligatoria en Vida Universitaria, cada valor válido, nunca en académico', () => {
    const vida = (over: Partial<FormState> = {}) => valid({ activity_type: 'vida_universitaria', career_ids: [], ...over });
    expect(validateForm(vida()).errors.experience_category).toBe('Este dato es obligatorio.');
    for (const c of ['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra'] as const) {
      const { errors, payload } = validateForm(vida({ experience_category: c }));
      expect(errors, c).toEqual({});
      expect(payload?.experience_category).toBe(c);
    }
    expect(validateForm(vida({ experience_category: 'musical' as never })).errors.experience_category).toMatch(/categoría/);
    // un académico nunca arrastra la categoría, aunque el estado local la conserve
    const acad = validateForm(valid({ experience_category: 'deportiva' }));
    expect(acad.errors).toEqual({});
    expect(acad.payload?.experience_category).toBeNull();
    expect(buildDraft(valid({ experience_category: 'deportiva' }))).not.toHaveProperty('experience_category', 'deportiva');
  });

  it('objetivo: obligatorio en académico, opcional en Vida Universitaria (null, sin texto por defecto)', () => {
    expect(validateForm(valid({ objective: '' })).errors.objective).toBe('Este dato es obligatorio.');
    const vida = validateForm(valid({ activity_type: 'vida_universitaria', experience_category: 'otra', career_ids: [], objective: '   ' }));
    expect(vida.errors).toEqual({});
    expect(vida.payload?.objective).toBeNull();
    expect(validateForm(valid({ activity_type: 'vida_universitaria', experience_category: 'otra', career_ids: [], objective: 'Integración' })).payload?.objective).toBe('Integración');
  });

  it('copy por tipo y títulos de pasos', () => {
    expect(copyFor('academica').title.label).toBe('Nombre del taller');
    expect(copyFor('vida_universitaria').title.label).toBe('Nombre de la actividad');
    expect(copyFor('vida_universitaria').student_pitch.label).toBe('Descripción corta');
    expect(copyFor('vida_universitaria').objective.label).toBe('¿Qué buscas generar con esta experiencia?');
    expect(stepsFor('vida_universitaria').map((s) => s.title)).toEqual(['Tus datos', 'Tu actividad', 'Experiencia', 'Logística', 'Revisa y envía']);
    expect(stepsFor('academica').map((s) => s.title)).toEqual(['Tus datos', 'Tu taller', 'Experiencia del alumno', 'Logística', 'Carreras relacionadas', 'Revisa y envía']);
  });

  it('validateStep reporta solo el paso pedido; la revisión valida todo', () => {
    const f = valid({ facilitator_name: '', title: '' });
    expect(Object.keys(validateStep(f, 'responsable'))).toEqual(['facilitator_name']);
    expect(Object.keys(validateStep(f, 'taller'))).toEqual(['title']);
    expect(Object.keys(validateStep(f, 'revision')).sort()).toEqual(['facilitator_name', 'title']);
    expect(stepIdOfField('keywords[1]')).toBe('experiencia');
    expect(stepIdOfField('career_ids')).toBe('carreras');
    expect(stepIdOfField('session_duration_minutes')).toBe('operacion');
    expect(stepIdOfField('facilitator_phone')).toBeUndefined();
    expect(stepIdOfField('division_id')).toBeUndefined();
  });
});

describe('pasos según el tipo de taller', () => {
  const ids = (type: FormState['activity_type']) => stepsFor(type).map((s) => s.id);

  it('académico (o aún sin elegir): 6 pasos con carreras', () => {
    expect(ids('academica')).toEqual(['responsable', 'taller', 'experiencia', 'operacion', 'carreras', 'revision']);
    expect(ids('')).toEqual(ids('academica'));
  });

  it('Vida Universitaria: omite el paso de carreras (5 pasos)', () => {
    expect(ids('vida_universitaria')).toEqual(['responsable', 'taller', 'experiencia', 'operacion', 'revision']);
  });
});

describe('mensajes y errores del backend', () => {
  it('mapea códigos a mensajes humanos', () => {
    expect(messageFor('title', 'TOO_SHORT')).toMatch(/mínimo 5/);
    expect(messageFor('notes', 'TOO_LONG')).toMatch(/máximo 1500/);
    expect(messageFor('session_duration_minutes', 'INVALID_DURATION')).toBe('Elige 30 minutos o 1 hora.');
  });

  it('describeSubmitError no filtra detalles internos', () => {
    const cases: [IntakeError, RegExp][] = [
      [new IntakeError('http', 422, 'VALIDATION_FAILED', [{ field: 'title', code: 'TOO_SHORT' }]), /Revisa los campos marcados/],
      [new IntakeError('http', 503, 'NO_ACTIVE_EDITION'), /aún no está disponible/],
      [new IntakeError('http', 422, 'INVALID_CAREER'), /catálogo.*actualizó/i],
      [new IntakeError('http', 422, 'CATALOG_MISMATCH'), /catálogo.*actualizó/i],
      [new IntakeError('http', 400, 'UNKNOWN_FIELDS'), /desactualizada/],
      [new IntakeError('http', 413, 'PAYLOAD_TOO_LARGE'), /demasiado extenso/],
      [new IntakeError('http', 500, 'INTERNAL_ERROR'), /problema de nuestro lado/],
      [new IntakeError('network', 0, 'NETWORK'), /conectarnos/],
    ];
    for (const [err, re] of cases) expect(describeSubmitError(err).message).toMatch(re);
    expect(describeSubmitError(new IntakeError('http', 422, 'VALIDATION_FAILED', [{ field: 'keywords[1]', code: 'DUPLICATE_KEYWORD' }])).fieldErrors.keywords).toMatch(/repetidas/);
    expect(describeSubmitError(new IntakeError('http', 422, 'VALIDATION_FAILED', [{ field: 'session_duration_minutes', code: 'INVALID_DURATION' }])).fieldErrors.session_duration_minutes).toBe('Elige 30 minutos o 1 hora.');
    expect(describeSubmitError(new IntakeError('http', 422, 'INVALID_CAREER')).reloadCatalog).toBe(true);
    expect(describeSubmitError(new IntakeError('http', 503, 'NO_ACTIVE_EDITION')).unavailable).toBe(true);
    const generic = describeSubmitError(new Error('relation "secret" does not exist: SELECT * FROM x')).message;
    expect(generic).not.toMatch(/secret|SELECT|relation/);
  });
});
