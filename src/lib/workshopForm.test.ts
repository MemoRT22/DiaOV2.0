import { describe, expect, it } from 'vitest';
import { IntakeError } from './workshopIntakeApi';
import { describeSubmitError, emptyForm, messageFor, stepOfField, validateForm, validateStep, type FormState } from './workshopForm';

const D = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const valid = (over: Partial<FormState> = {}): FormState => ({
  ...emptyForm(),
  facilitator_name: 'Ana Pérez',
  facilitator_email: 'Ana@Example.com',
  division_id: D,
  activity_type: 'academica',
  title: 'Código Rojo Cancún 2035',
  student_pitch: 'Resuelve una crisis digital en equipo durante una hora.',
  why_join: 'Porque vivirás cómo se trabaja bajo presión con tecnología real.',
  objective: 'Que el alumno identifique el rol de las TI en una emergencia.',
  student_experience: 'Simulación guiada con retos por equipos y retroalimentación.',
  takeaway: 'Una idea clara de qué hace un ingeniero en ciberseguridad.',
  keywords: ['ciberseguridad', 'inteligencia artificial', 'simulación'],
  session_duration_minutes: '45',
  capacity_per_session: '30',
  operating_start_time: '10:00',
  operating_end_time: '14:00',
  break_minutes: '10',
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
    expect(payload?.facilitator_phone).toBeNull();
    expect(payload?.career_ids).toEqual([C1, C2]);
    expect(payload?.session_duration_minutes).toBe(45);
  });

  it('keywords: mínimo, máximo y repetidas sin acentos ni mayúsculas', () => {
    expect(validateForm(valid({ keywords: ['a1', 'b2'] })).errors.keywords).toMatch(/al menos 3/);
    expect(validateForm(valid({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] })).errors.keywords).toMatch(/hasta 5/);
    expect(validateForm(valid({ keywords: ['Simulación', 'simulacion', 'x'] })).errors.keywords).toMatch(/repetidas/);
    expect(validateForm(valid({ keywords: ['Año', 'ANO', 'x'] })).errors.keywords).toMatch(/repetidas/);
  });

  it('campos obligatorios, correo, números y horarios', () => {
    const e = validateForm(emptyForm()).errors;
    expect(e.facilitator_name).toBe('Este dato es obligatorio.');
    expect(e.division_id).toBeTruthy();
    expect(e.career_ids).toMatch(/al menos una carrera/);
    expect(validateForm(valid({ facilitator_email: 'sin-arroba' })).errors.facilitator_email).toMatch(/correo válido/);
    expect(validateForm(valid({ session_duration_minutes: '0' })).errors.session_duration_minutes).toMatch(/entre 5 y 480/);
    expect(validateForm(valid({ session_duration_minutes: 'abc' })).errors.session_duration_minutes).toMatch(/número entero/);
    expect(validateForm(valid({ break_minutes: '-1' })).errors.break_minutes).toBeTruthy();
    expect(validateForm(valid({ operating_start_time: '14:00', operating_end_time: '10:00' })).errors.operating_end_time).toMatch(/posterior/);
  });

  it('el espacio puede quedar «Por confirmar»; sin marcar, es obligatorio', () => {
    expect(validateForm(valid({ room_tbd: true, room_space: '' })).errors.room_space).toBeUndefined();
    expect(validateForm(valid({ room_tbd: false, room_space: '' })).errors.room_space).toBeTruthy();
  });

  it('una o varias carreras, sin tope', () => {
    expect(validateForm(valid({ career_ids: [C1] })).errors.career_ids).toBeUndefined();
    const many = Array.from({ length: 35 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(validateForm(valid({ career_ids: many })).errors.career_ids).toBeUndefined();
  });

  it('validateStep solo reporta el paso pedido; la revisión valida todo', () => {
    const f = valid({ facilitator_name: '', title: '' });
    expect(Object.keys(validateStep(f, 0))).toEqual(['facilitator_name']);
    expect(Object.keys(validateStep(f, 1))).toEqual(['title']);
    expect(Object.keys(validateStep(f, 5)).sort()).toEqual(['facilitator_name', 'title']);
    expect(stepOfField('keywords[1]')).toBe(2);
    expect(stepOfField('career_ids')).toBe(4);
  });
});

describe('mensajes y errores del backend', () => {
  it('mapea códigos a mensajes humanos', () => {
    expect(messageFor('title', 'TOO_SHORT')).toMatch(/mínimo 5/);
    expect(messageFor('notes', 'TOO_LONG')).toMatch(/máximo 1500/);
  });

  it('describeSubmitError no filtra detalles internos', () => {
    const cases: [IntakeError, RegExp][] = [
      [new IntakeError('http', 422, 'VALIDATION_FAILED', [{ field: 'title', code: 'TOO_SHORT' }]), /Revisa los campos marcados/],
      [new IntakeError('http', 503, 'NO_ACTIVE_EDITION'), /aún no está disponible/],
      [new IntakeError('http', 422, 'INVALID_CAREER'), /catálogo.*actualizó/i],
      [new IntakeError('http', 422, 'CATALOG_MISMATCH'), /catálogo.*actualizó/i],
      [new IntakeError('http', 413, 'PAYLOAD_TOO_LARGE'), /demasiado extenso/],
      [new IntakeError('http', 500, 'INTERNAL_ERROR'), /problema de nuestro lado/],
      [new IntakeError('network', 0, 'NETWORK'), /conectarnos/],
    ];
    for (const [err, re] of cases) expect(describeSubmitError(err).message).toMatch(re);
    expect(describeSubmitError(new IntakeError('http', 422, 'VALIDATION_FAILED', [{ field: 'keywords[1]', code: 'DUPLICATE_KEYWORD' }])).fieldErrors.keywords).toMatch(/repetidas/);
    expect(describeSubmitError(new IntakeError('http', 422, 'INVALID_CAREER')).reloadCatalog).toBe(true);
    expect(describeSubmitError(new IntakeError('http', 503, 'NO_ACTIVE_EDITION')).unavailable).toBe(true);
    const generic = describeSubmitError(new Error('relation "secret" does not exist: SELECT * FROM x')).message;
    expect(generic).not.toMatch(/secret|SELECT|relation/);
  });
});
