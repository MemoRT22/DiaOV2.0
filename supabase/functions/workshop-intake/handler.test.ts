// Pruebas dirigidas de la Edge Function `workshop-intake` (handler + validación), con la base simulada.
// Ejecutar:  node --test supabase/functions/workshop-intake/handler.test.ts
// La verificación contra la base real vive en supabase/tests/regression_workshop_intake.sql y en
// integration.test.ts (opt-in con WORKSHOP_INTAKE_URL).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest, type Deps, type RpcResult } from './handler.ts';
import { LIMITS, SESSION_DURATIONS } from './validation.ts';

const URL_ = 'https://example.test/functions/v1/workshop-intake';
const DIV = '11111111-1111-4111-8111-111111111111';
const C1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333';

const valid = () => ({
  facilitator_name: 'Ana Pérez',
  facilitator_email: 'ana@example.com',
  activity_type: 'academica',
  title: 'Código Rojo Cancún 2035',
  student_pitch: 'Resuelve una crisis digital en equipo durante una hora.',
  objective: 'Que el alumno identifique el rol de las TI en una emergencia.',
  takeaway: 'Una idea clara de qué hace un ingeniero en ciberseguridad.',
  keywords: ['ciberseguridad', 'inteligencia artificial', 'simulación'],
  session_duration_minutes: 60,
  capacity_per_session: 30,
  building: 'Edificio A',
  room_space: 'Por confirmar',
  requirements: null,
  notes: null,
  career_ids: [C1, C2],
});

type Call = { fn: string; args?: Record<string, unknown> };
function makeDeps(over: Partial<Deps> = {}, reply?: (fn: string) => RpcResult) {
  const calls: Call[] = [];
  const logs: unknown[] = [];
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (reply) return reply(fn);
      if (fn === 'workshop_intake_catalog_internal') {
        return {
          data: {
            edition: { name: 'Día OV 2026', event_date: '2026-11-01' },
            divisions: [{ division_id: DIV, division_name: 'Ingeniería' }],
            careers: [{ career_id: C1, career_name: 'TI e IA', division_id: DIV }],
          },
          error: null,
        };
      }
      return { data: { submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'submitted', submitted_at: '2026-10-05T12:00:00Z' }, error: null };
    },
    log: (...a) => logs.push(a),
    ...over,
  };
  return { deps, calls, logs };
}
const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const bodyOf = async (r: Response) => (await r.json()) as Record<string, any>;
const errorsOf = (b: Record<string, any>): string[] => (b.errors ?? []).map((e: any) => `${e.field}:${e.code}`);

async function expectInvalid(mutate: (p: Record<string, any>) => void, expected: string) {
  const { deps, calls } = makeDeps();
  const p = valid() as Record<string, any>;
  mutate(p);
  const res = await handleRequest(post(p), deps);
  assert.equal(res.status, 422, expected);
  assert.ok(errorsOf(await bodyOf(res)).includes(expected), `esperaba ${expected}`);
  assert.equal(calls.length, 0, 'no debe escribir nada');
}

// ---------- GET ----------
test('GET devuelve solo el catálogo del formulario', async () => {
  const { deps, calls } = makeDeps();
  const res = await handleRequest(new Request(URL_, { method: 'GET' }), deps);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const b = await bodyOf(res);
  assert.deepEqual(Object.keys(b).sort(), ['activity_types', 'careers', 'divisions', 'edition', 'experience_categories', 'limits']);
  assert.deepEqual(b.experience_categories, [
    { value: 'liderazgo', label: 'Liderazgo' },
    { value: 'deportiva', label: 'Deportiva' },
    { value: 'artistica_cultural', label: 'Artística / cultural' },
    { value: 'vida_universitaria', label: 'Vida universitaria' },
    { value: 'otra', label: 'Otra' },
  ]);
  assert.deepEqual(b.careers[0], { career_id: C1, career_name: 'TI e IA', division_id: DIV });
  assert.deepEqual(b.activity_types.map((t: any) => t.value), ['academica', 'vida_universitaria']);
  assert.deepEqual(b.activity_types.map((t: any) => t.label), ['Taller académico', 'Vida Universitaria']);
  assert.deepEqual(Object.keys(b.edition).sort(), ['event_date', 'name']);
  assert.deepEqual(calls.map((c) => c.fn), ['workshop_intake_catalog_internal']);
});

test('GET con catálogo real vacío responde 200 con listas vacías (el frontend muestra "Registro aún no disponible")', async () => {
  const { deps } = makeDeps({}, () => ({
    data: { edition: { name: 'Día OV 2026', event_date: '2026-10-15' }, divisions: [], careers: [] },
    error: null,
  }));
  const res = await handleRequest(new Request(URL_), deps);
  assert.equal(res.status, 200);
  const b = await bodyOf(res);
  assert.deepEqual(b.divisions, []);
  assert.deepEqual(b.careers, []);
  assert.ok(Array.isArray(b.activity_types) && b.limits);
});

test('POST: la base rechaza división o carreras demo con INVALID_DIVISION / INVALID_CAREER (422, sin filtrar detalles)', async () => {
  for (const code of ['INVALID_DIVISION', 'INVALID_CAREER']) {
    const { deps } = makeDeps({}, () => ({ data: null, error: { code: 'P0001', message: code } }));
    const res = await handleRequest(post(valid()), deps);
    assert.equal(res.status, 422);
    assert.deepEqual(await bodyOf(res), { error: code });
  }
});

test('GET sin edición activa responde 503; error interno responde 500 genérico', async () => {
  let { deps } = makeDeps({}, () => ({ data: null, error: { message: 'NO_ACTIVE_EDITION' } }));
  assert.equal((await handleRequest(new Request(URL_), deps)).status, 503);
  ({ deps } = makeDeps({}, () => ({ data: null, error: { code: 'XX000', message: 'relation "secret_table" exploded at /var/lib' } })));
  const res = await handleRequest(new Request(URL_), deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await bodyOf(res), { error: 'INTERNAL_ERROR' });
});

// ---------- POST válido ----------
test('POST válido: 201, respuesta mínima y payload normalizado sin campos del servidor', async () => {
  const { deps, calls } = makeDeps();
  const p = { ...valid(), facilitator_email: '  Ana@Example.COM ', title: '  Código   Rojo \n Cancún 2035 ', requirements: '  Laptop  \r\n\r\n\r\n\r\n  Proyector ' };
  const res = await handleRequest(post(p), deps);
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(await bodyOf(res)).sort(), ['status', 'submission_id', 'submitted_at']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'create_workshop_submission_internal');
  const sent = calls[0].args!.p_payload as Record<string, any>;
  assert.equal(sent.facilitator_email, 'ana@example.com');
  assert.equal(sent.title, 'Código Rojo Cancún 2035');
  assert.equal(sent.requirements, 'Laptop\n\nProyector');
  assert.equal(sent.room_space, 'Por confirmar');
  for (const forbidden of ['status', 'edition_id', 'reviewed_by', 'reviewed_at', 'published_activity_id', 'admin_notes', 'is_demo',
    'facilitator_phone', 'division_id', 'operating_start_time', 'operating_end_time', 'break_minutes']) {
    assert.ok(!(forbidden in sent), `${forbidden} no debe viajar a la base`);
  }
  assert.deepEqual(Object.keys(sent).sort(), [
    'activity_type', 'building', 'capacity_per_session', 'career_ids', 'experience_category', 'facilitator_email', 'facilitator_name', 'keywords', 'notes',
    'objective', 'requirements', 'room_space', 'session_duration_minutes', 'student_pitch', 'takeaway', 'title',
  ]);
});

test('POST: acepta correo no institucional y varias carreras (de divisiones distintas) sin tope', async () => {
  const { deps, calls } = makeDeps();
  const many = Array.from({ length: 35 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const p = { ...valid(), facilitator_email: 'persona@gmail.com', career_ids: [C1, C2, ...many] };
  const res = await handleRequest(post(p), deps);
  assert.equal(res.status, 201);
  const sent = calls[0].args!.p_payload as Record<string, any>;
  assert.equal(sent.career_ids.length, 37);
  assert.equal(sent.requirements, null);
});

test('POST: duración 30 y 60 son válidas', async () => {
  for (const d of SESSION_DURATIONS.map((x) => x.value)) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(post({ ...valid(), session_duration_minutes: d }), deps);
    assert.equal(res.status, 201, String(d));
    assert.equal((calls[0].args!.p_payload as Record<string, any>).session_duration_minutes, d);
  }
});

test('Vida Universitaria: sin carreras (vacías o ausentes) es válido y viaja con el tipo correcto', async () => {
  for (const variant of ['empty', 'absent'] as const) {
    const { deps, calls } = makeDeps();
    const p = { ...valid(), activity_type: 'vida_universitaria', experience_category: 'otra' } as Record<string, any>;
    if (variant === 'empty') p.career_ids = []; else delete p.career_ids;
    const res = await handleRequest(post(p), deps);
    assert.equal(res.status, 201, variant);
    const sent = calls[0].args!.p_payload as Record<string, any>;
    assert.equal(sent.activity_type, 'vida_universitaria');
    assert.deepEqual(sent.career_ids, []);
  }
});

const vida = (p: Record<string, any>, category: unknown = 'deportiva') => {
  p.activity_type = 'vida_universitaria';
  p.career_ids = [];
  if (category !== undefined) p.experience_category = category;
};

test('académico: sin categoría de experiencia es válido y viaja como null; con categoría se rechaza', async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await handleRequest(post(valid()), deps)).status, 201);
  assert.equal((calls[0].args!.p_payload as Record<string, any>).experience_category, null);
  await expectInvalid((p) => { p.experience_category = 'deportiva'; }, 'experience_category:NOT_ALLOWED');
  await expectInvalid((p) => { p.experience_category = 'liderazgo'; }, 'experience_category:NOT_ALLOWED');
});

test('académico: objetivo y carreras siguen siendo obligatorios', async () => {
  await expectInvalid((p) => { delete p.objective; }, 'objective:REQUIRED');
  await expectInvalid((p) => { p.objective = '   '; }, 'objective:REQUIRED');
  await expectInvalid((p) => { p.objective = 'corto'; }, 'objective:TOO_SHORT');
  await expectInvalid((p) => { p.career_ids = []; }, 'career_ids:CAREERS_REQUIRED');
});

test('Vida Universitaria: cada una de las 5 categorías es válida y viaja con career_ids vacío', async () => {
  for (const cat of ['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra']) {
    const { deps, calls } = makeDeps();
    const p = valid() as Record<string, any>;
    vida(p, cat);
    const res = await handleRequest(post(p), deps);
    assert.equal(res.status, 201, cat);
    const sent = calls[0].args!.p_payload as Record<string, any>;
    assert.equal(sent.experience_category, cat);
    assert.equal(sent.activity_type, 'vida_universitaria');
    assert.deepEqual(sent.career_ids, []);
  }
});

test('Vida Universitaria: categoría requerida, desconocida o de tipo inválido se rechaza', async () => {
  await expectInvalid((p) => { vida(p); delete p.experience_category; }, 'experience_category:REQUIRED');
  await expectInvalid((p) => vida(p, null), 'experience_category:REQUIRED');
  await expectInvalid((p) => vida(p, 'musical'), 'experience_category:INVALID_EXPERIENCE_CATEGORY');
  await expectInvalid((p) => vida(p, 'Liderazgo'), 'experience_category:INVALID_EXPERIENCE_CATEGORY');
  await expectInvalid((p) => vida(p, 7), 'experience_category:INVALID_TYPE');
});

test('Vida Universitaria: objetivo opcional (ausente, nulo o vacío → null, sin texto por defecto) pero válido si se da', async () => {
  for (const variant of ['absent', 'null', 'blank'] as const) {
    const { deps, calls } = makeDeps();
    const p = valid() as Record<string, any>;
    vida(p);
    if (variant === 'absent') delete p.objective; else if (variant === 'null') p.objective = null; else p.objective = '  \n ';
    assert.equal((await handleRequest(post(p), deps)).status, 201, variant);
    assert.equal((calls[0].args!.p_payload as Record<string, any>).objective, null);
  }
  const { deps, calls } = makeDeps();
  const p = valid() as Record<string, any>;
  vida(p);
  p.objective = 'Integración y convivencia';
  assert.equal((await handleRequest(post(p), deps)).status, 201);
  assert.equal((calls[0].args!.p_payload as Record<string, any>).objective, 'Integración y convivencia');
  await expectInvalid((q) => { vida(q); q.objective = 5; }, 'objective:INVALID_TYPE');
  await expectInvalid((q) => { vida(q); q.objective = 'x'.repeat(LIMITS.objective.max + 1); }, 'objective:TOO_LONG');
});

test('Vida Universitaria sigue exigiendo takeaway y keywords', async () => {
  for (const f of ['takeaway', 'keywords']) {
    await expectInvalid((p) => { vida(p); delete p[f]; }, `${f}:REQUIRED`);
  }
});

test('Vida Universitaria con carreras opcionales sigue validando que sean UUID sin duplicados', async () => {
  await expectInvalid((p) => { p.activity_type = 'vida_universitaria'; p.career_ids = [C1, C1]; }, 'career_ids[1]:DUPLICATE_CAREER');
  await expectInvalid((p) => { p.activity_type = 'vida_universitaria'; p.career_ids = ['no-es-uuid']; }, 'career_ids[0]:INVALID_CAREER');
});

// ---------- POST inválido ----------
test('académico: carreras cero, ausentes, duplicadas e inválidas', async () => {
  await expectInvalid((p) => { p.career_ids = []; }, 'career_ids:CAREERS_REQUIRED');
  await expectInvalid((p) => { delete p.career_ids; }, 'career_ids:CAREERS_REQUIRED');
  await expectInvalid((p) => { p.career_ids = [C1, C1]; }, 'career_ids[1]:DUPLICATE_CAREER');
  await expectInvalid((p) => { p.career_ids = [C1, C1.toUpperCase()]; }, 'career_ids[1]:DUPLICATE_CAREER');
  await expectInvalid((p) => { p.career_ids = ['no-es-uuid']; }, 'career_ids[0]:INVALID_CAREER');
  await expectInvalid((p) => { p.career_ids = [123]; }, 'career_ids[0]:INVALID_CAREER');
});

test('tipo de actividad: solo academica | vida_universitaria; el valor antiguo liderazgo se rechaza', async () => {
  await expectInvalid((p) => { p.activity_type = 'liderazgo'; }, 'activity_type:INVALID_ACTIVITY_TYPE');
  await expectInvalid((p) => { p.activity_type = 'taller'; }, 'activity_type:INVALID_ACTIVITY_TYPE');
  await expectInvalid((p) => { p.activity_type = 'Vida Universitaria'; }, 'activity_type:INVALID_ACTIVITY_TYPE');
  await expectInvalid((p) => { p.activity_type = 7; }, 'activity_type:INVALID_TYPE');
  await expectInvalid((p) => { delete p.activity_type; }, 'activity_type:REQUIRED');
});

test('campos retirados del formulario (teléfono, división, horario, descanso, why_join, student_experience) se rechazan como UNKNOWN_FIELDS sin escribir', async () => {
  const retired: Record<string, unknown>[] = [
    { why_join: 'Porque sí' },
    { student_experience: 'Hará cosas' },
    { facilitator_phone: '998 123 4567' },
    { division_id: DIV },
    { operating_start_time: '10:00' },
    { operating_end_time: '12:00' },
    { break_minutes: 0 },
    { facilitator_phone: '998 123 4567', division_id: DIV, operating_start_time: '10:00', operating_end_time: '12:00', break_minutes: 0 },
  ];
  for (const extra of retired) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(post({ ...valid(), ...extra }), deps);
    assert.equal(res.status, 400, JSON.stringify(extra));
    const b = await bodyOf(res);
    assert.equal(b.error, 'UNKNOWN_FIELDS');
    for (const k of Object.keys(extra)) assert.ok(b.fields.includes(k));
    assert.equal(b.admin_fields_forbidden, false);
    assert.equal(calls.length, 0);
  }
});

test('duración: solo 30 o 60 minutos; capacidad dentro de límites', async () => {
  for (const bad of [0, -5, 5, 15, 29, 31, 45, 59, 61, 90, 120, 480]) {
    await expectInvalid((p) => { p.session_duration_minutes = bad; }, 'session_duration_minutes:INVALID_DURATION');
  }
  await expectInvalid((p) => { p.session_duration_minutes = 30.5; }, 'session_duration_minutes:INVALID_TYPE');
  await expectInvalid((p) => { p.session_duration_minutes = '60'; }, 'session_duration_minutes:INVALID_TYPE');
  await expectInvalid((p) => { p.session_duration_minutes = null; }, 'session_duration_minutes:REQUIRED');
  await expectInvalid((p) => { delete p.session_duration_minutes; }, 'session_duration_minutes:REQUIRED');
  await expectInvalid((p) => { p.capacity_per_session = 0; }, 'capacity_per_session:TOO_LOW');
  await expectInvalid((p) => { p.capacity_per_session = LIMITS.capacityPerSession.max + 1; }, 'capacity_per_session:TOO_HIGH');
});

test('keywords: menos de 3, más de 5, vacía, duplicada y tipo inválido', async () => {
  await expectInvalid((p) => { p.keywords = ['a1', 'b2']; }, 'keywords:TOO_FEW_KEYWORDS');
  await expectInvalid((p) => { p.keywords = ['a', 'b', 'c', 'd', 'e', 'f']; }, 'keywords:TOO_MANY_KEYWORDS');
  await expectInvalid((p) => { p.keywords = ['uno', '   ', 'tres']; }, 'keywords[1]:EMPTY_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['IA', 'ia', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['Simulación', 'simulacion', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['  SIMULACIÓN ', 'simulacion', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['Año', 'ANO', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['IA  generativa', 'ia generativa', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = ['Pingüino', 'pinguino', 'tres']; }, 'keywords[1]:DUPLICATE_KEYWORD');
  await expectInvalid((p) => { p.keywords = 'a, b, c'; }, 'keywords:INVALID_TYPE');
  await expectInvalid((p) => { p.keywords = ['a', 'b', 7]; }, 'keywords[2]:INVALID_TYPE');
  await expectInvalid((p) => { p.keywords = ['a', 'b', 'x'.repeat(LIMITS.keywords.maxLength + 1)]; }, 'keywords[2]:TOO_LONG');
  await expectInvalid((p) => { delete p.keywords; }, 'keywords:REQUIRED');
});

test('campos requeridos vacíos, tipos y longitudes', async () => {
  for (const f of ['facilitator_name', 'title', 'student_pitch', 'objective', 'takeaway', 'building', 'room_space']) {
    await expectInvalid((p) => { p[f] = '   \n  '; }, `${f}:REQUIRED`);
    await expectInvalid((p) => { delete p[f]; }, `${f}:REQUIRED`);
    await expectInvalid((p) => { p[f] = 42; }, `${f}:INVALID_TYPE`);
  }
  await expectInvalid((p) => { p.facilitator_name = 'x'.repeat(20_000); }, 'facilitator_name:TOO_LONG');
  await expectInvalid((p) => { p.student_pitch = 'x'.repeat(LIMITS.studentPitch.max + 1); }, 'student_pitch:TOO_LONG');
  await expectInvalid((p) => { p.title = 'abc'; }, 'title:TOO_SHORT');
  await expectInvalid((p) => { p.notes = 'x'.repeat(LIMITS.notesMax + 1); }, 'notes:TOO_LONG');
  await expectInvalid((p) => { p.requirements = 5; }, 'requirements:INVALID_TYPE');
});

test('correo', async () => {
  for (const bad of ['', 'sin-arroba', 'a@b', 'a b@c.com', '@c.com', `${'a'.repeat(250)}@x.com`]) {
    await expectInvalid((p) => { p.facilitator_email = bad; }, bad === '' ? 'facilitator_email:REQUIRED' : 'facilitator_email:INVALID_EMAIL');
  }
  await expectInvalid((p) => { delete p.facilitator_email; }, 'facilitator_email:REQUIRED');
});

test('muchos errores se reportan juntos', async () => {
  const { deps } = makeDeps();
  const res = await handleRequest(post({ ...valid(), title: '', keywords: [], career_ids: [] }), deps);
  assert.equal(res.status, 422);
  const errs = errorsOf(await bodyOf(res));
  assert.ok(errs.includes('title:REQUIRED') && errs.includes('keywords:TOO_FEW_KEYWORDS') && errs.includes('career_ids:CAREERS_REQUIRED'));
});

// ---------- Propiedades administrativas ----------
test('propiedades administrativas o desconocidas rechazan el request completo (400) sin escribir', async () => {
  const attacks: Record<string, unknown>[] = [
    { status: 'published' },
    { edition_id: '99999999-9999-4999-8999-999999999999' },
    { reviewed_by: DIV },
    { reviewed_at: '2026-01-01T00:00:00Z' },
    { published_activity_id: DIV },
    { admin_notes: 'aprobado' },
    { is_demo: true },
    { id: DIV },
    { campo_cualquiera: 1 },
    { status: 'published', edition_id: DIV, reviewed_by: DIV, reviewed_at: 'x', published_activity_id: DIV },
  ];
  for (const extra of attacks) {
    const { deps, calls } = makeDeps();
    const res = await handleRequest(post({ ...valid(), ...extra }), deps);
    assert.equal(res.status, 400, JSON.stringify(extra));
    const b = await bodyOf(res);
    assert.equal(b.error, 'UNKNOWN_FIELDS');
    for (const k of Object.keys(extra)) assert.ok(b.fields.includes(k));
    assert.equal(calls.length, 0);
  }
});

// ---------- Body y método ----------
test('body inválido: JSON roto, no objeto, vacío, UTF-8 inválido', async () => {
  const { deps, calls } = makeDeps();
  for (const [body, code] of [['{no es json', 'INVALID_JSON'], ['', 'INVALID_JSON'], ['[1,2]', 'INVALID_PAYLOAD'], ['null', 'INVALID_PAYLOAD'], ['"texto"', 'INVALID_PAYLOAD'], ['42', 'INVALID_PAYLOAD']] as const) {
    const res = await handleRequest(post(body), deps);
    assert.equal(res.status, 400, body);
    assert.equal((await bodyOf(res)).error, code, body);
  }
  const bad = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
  const res = await handleRequest(bad, deps);
  assert.equal(res.status, 400);
  assert.equal((await bodyOf(res)).error, 'INVALID_ENCODING');
  assert.equal(calls.length, 0);
});

test('Content-Type distinto de JSON responde 415', async () => {
  const { deps, calls } = makeDeps();
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const res = await handleRequest(post(valid(), ct ? { 'content-type': ct } : {}), deps);
    assert.equal(res.status, 415, ct);
  }
  assert.equal((await handleRequest(post(valid(), { 'content-type': 'application/json; charset=utf-8' }), deps)).status, 201);
  assert.equal(calls.length, 1);
});

test('body demasiado grande responde 413 (por Content-Length y por conteo real de bytes)', async () => {
  const { deps, calls } = makeDeps();
  const huge = JSON.stringify({ ...valid(), notes: 'x'.repeat(LIMITS.bodyMaxBytes) });
  assert.equal((await handleRequest(post(huge), deps)).status, 413);
  const lying = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '10' }, body: huge });
  assert.equal((await handleRequest(lying, deps)).status, 413);
  assert.equal(calls.length, 0);
});

test('método no permitido responde 405 con Allow; OPTIONS responde CORS', async () => {
  const { deps, calls } = makeDeps();
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const res = await handleRequest(new Request(URL_, { method }), deps);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, POST, OPTIONS');
  }
  const opt = await handleRequest(new Request(URL_, { method: 'OPTIONS' }), deps);
  assert.equal(opt.status, 204);
  assert.match(opt.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.match(opt.headers.get('access-control-allow-headers') ?? '', /Content-Type/i);
  assert.equal(calls.length, 0);
});

// ---------- Errores de base de datos ----------
test('errores de la base: negocio 422, constraint 422, internos 500 genéricos sin filtrar detalles', async () => {
  for (const code of ['INVALID_DIVISION', 'INVALID_CAREER', 'DUPLICATE_CAREER', 'CAREERS_REQUIRED', 'CATALOG_MISMATCH']) {
    const { deps } = makeDeps({}, () => ({ data: null, error: { code: 'P0001', message: code } }));
    const res = await handleRequest(post(valid()), deps);
    assert.equal(res.status, 422, code);
    assert.deepEqual(await bodyOf(res), { error: code });
  }
  let { deps } = makeDeps({}, () => ({ data: null, error: { code: '23514', message: 'new row violates check constraint "workshop_submissions_keywords_check"' } }));
  let res = await handleRequest(post(valid()), deps);
  assert.equal(res.status, 422);
  assert.deepEqual(await bodyOf(res), { error: 'VALIDATION_FAILED' });
  ({ deps } = makeDeps({}, () => ({ data: null, error: { code: '42P01', message: 'relation "x" does not exist; SELECT * FROM secret' } })));
  res = await handleRequest(post(valid()), deps);
  assert.equal(res.status, 500);
  const text = JSON.stringify(await bodyOf(res));
  assert.deepEqual(JSON.parse(text), { error: 'INTERNAL_ERROR' });
  ({ deps } = makeDeps({}, () => ({ data: null, error: { message: 'NO_ACTIVE_EDITION' } })));
  assert.equal((await handleRequest(post(valid()), deps)).status, 503);
});

test('una excepción inesperada responde 500 genérico y el log no incluye el body', async () => {
  const { deps, logs } = makeDeps({ rpc: async () => { throw new Error('boom ana@example.com'); } });
  const res = await handleRequest(post(valid()), deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await bodyOf(res), { error: 'INTERNAL_ERROR' });
  assert.ok(!JSON.stringify(logs).includes('ana@example.com'));
});

// ---------- Antiabuso ----------
test('el punto de extensión antiabuso puede rechazar antes de validar o escribir', async () => {
  const { deps, calls } = makeDeps({ antiAbuse: async () => ({ ok: false, status: 403, error: 'CAPTCHA_REQUIRED' }) });
  const res = await handleRequest(post(valid()), deps);
  assert.equal(res.status, 403);
  assert.equal((await bodyOf(res)).error, 'CAPTCHA_REQUIRED');
  assert.equal(calls.length, 0);
});
