// Prueba de integración CONTRA LA FUNCIÓN DESPLEGADA (opt-in). Crea una propuesta real con título marcador
// `ZZ-INTAKE-IT-<id>`; hay que limpiarla después:
//   delete from workshop_submissions where title like 'ZZ-INTAKE-IT-%';
// Ejecutar:  WORKSHOP_INTAKE_URL=https://<ref>.supabase.co/functions/v1/workshop-intake \
//            node --test supabase/functions/workshop-intake/integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

const URL_ = process.env.WORKSHOP_INTAKE_URL;
const skip = URL_ ? false : 'WORKSHOP_INTAKE_URL no definida';
const json = { 'content-type': 'application/json' };

type Catalog = { edition: { name: string }; divisions: { division_id: string }[]; careers: { career_id: string; division_id: string }[]; activity_types: unknown[]; limits: unknown };
async function catalog(): Promise<Catalog> {
  const res = await fetch(URL_!);
  assert.equal(res.status, 200);
  return (await res.json()) as Catalog;
}
const payload = (cat: Catalog, over: Record<string, unknown> = {}) => ({
  facilitator_name: 'Prueba Integración',
  facilitator_email: 'integracion@example.com',
  activity_type: 'academica',
  title: `ZZ-INTAKE-IT-${crypto.randomUUID().slice(0, 8)}`,
  student_pitch: 'Pitch de prueba de integración para el formulario.',
  why_join: 'Razón de prueba de integración para el formulario.',
  objective: 'Objetivo de prueba de integración para el formulario.',
  student_experience: 'Experiencia de prueba de integración para el formulario.',
  takeaway: 'Aprendizaje de prueba',
  keywords: ['uno', 'dos', 'tres'],
  session_duration_minutes: 30,
  capacity_per_session: 20,
  building: 'Edificio X',
  room_space: 'Por confirmar',
  career_ids: cat.careers.slice(0, 2).map((c) => c.career_id),
  ...over,
});

// Si todavía no hay catálogo REAL (el catálogo público nunca incluye datos demo), las pruebas que necesitan
// una división y carreras reales se omiten con un aviso.
const noReal = async () => (URL_ ? ((await catalog()).careers.length === 0 || (await catalog()).divisions.length === 0 ? 'catálogo real vacío' : false) : skip);

test('GET: catálogo mínimo y CORS', { skip }, async () => {
  const res = await fetch(URL_!);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const b = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(b).sort(), ['activity_types', 'careers', 'divisions', 'edition', 'experience_categories', 'limits']);
  assert.deepEqual((b.experience_categories as { value: string }[]).map((c) => c.value), ['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra']);
  assert.deepEqual((b.activity_types as { value: string }[]).map((t) => t.value), ['academica', 'vida_universitaria']);
  const cat = b as unknown as Catalog;
  assert.ok(Array.isArray(cat.divisions) && Array.isArray(cat.careers));
  if (cat.careers.length > 0) assert.deepEqual(Object.keys(cat.careers[0]).sort(), ['career_id', 'career_name', 'division_id']);
});

// Opcional: ids de datos DEMO conocidos (WORKSHOP_INTAKE_DEMO_DIVISION / WORKSHOP_INTAKE_DEMO_CAREER): nunca deben ofrecerse ni aceptarse
// (la división ya no es entrada del formulario; una carrera demo se rechaza con INVALID_CAREER).
const demoDiv = process.env.WORKSHOP_INTAKE_DEMO_DIVISION;
const demoCareer = process.env.WORKSHOP_INTAKE_DEMO_CAREER;
test('catálogo público sin datos demo y POST rechaza división/carrera demo', { skip: skip || (demoDiv && demoCareer ? false : 'sin ids demo') }, async () => {
  const cat = await catalog();
  assert.ok(!cat.divisions.some((d) => d.division_id === demoDiv));
  assert.ok(!cat.careers.some((c) => c.career_id === demoCareer || c.division_id === demoDiv));
  const base = {
    facilitator_name: 'Prueba Integración', facilitator_email: 'integracion@example.com', activity_type: 'academica',
    title: `ZZ-INTAKE-IT-${crypto.randomUUID().slice(0, 8)}`,
    student_pitch: 'Pitch de prueba de integración para el formulario.', why_join: 'Razón de prueba de integración para el formulario.',
    objective: 'Objetivo de prueba de integración para el formulario.', student_experience: 'Experiencia de prueba de integración para el formulario.',
    takeaway: 'Aprendizaje de prueba', keywords: ['uno', 'dos', 'tres'], session_duration_minutes: 30, capacity_per_session: 20,
    building: 'Edificio X', room_space: 'Por confirmar',
  };
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify({ ...base, career_ids: [demoCareer] }) });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: string }).error, 'INVALID_CAREER');
});

test('POST con campos retirados (teléfono, división, horario, descanso): 400 UNKNOWN_FIELDS sin guardar', { skip }, async () => {
  const cat = await catalog();
  const base = payload({ ...cat, careers: [{ career_id: crypto.randomUUID(), division_id: '' }], divisions: [] });
  for (const extra of [{ facilitator_phone: '998 123 4567' }, { division_id: crypto.randomUUID() }, { operating_start_time: '10:00' }, { operating_end_time: '12:00' }, { break_minutes: 0 }]) {
    const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify({ ...base, ...extra }) });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(((await res.json()) as { error: string }).error, 'UNKNOWN_FIELDS');
  }
});

test('POST con duración distinta de 30 o 60 y tipo antiguo liderazgo: 422 sin guardar', { skip }, async () => {
  const cat = await catalog();
  const base = payload({ ...cat, careers: [{ career_id: crypto.randomUUID(), division_id: '' }], divisions: [] });
  let res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify({ ...base, session_duration_minutes: 45 }) });
  assert.equal(res.status, 422);
  assert.ok(((await res.json()) as { errors: { field: string; code: string }[] }).errors.some((e) => e.field === 'session_duration_minutes' && e.code === 'INVALID_DURATION'));
  res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify({ ...base, activity_type: 'liderazgo' }) });
  assert.equal(res.status, 422);
  assert.ok(((await res.json()) as { errors: { field: string; code: string }[] }).errors.some((e) => e.field === 'activity_type' && e.code === 'INVALID_ACTIVITY_TYPE'));
});

test('POST válido: 201 submitted, respuesta mínima', { skip: await noReal() }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat)) });
  assert.equal(res.status, 201);
  const b = (await res.json()) as Record<string, string>;
  assert.deepEqual(Object.keys(b).sort(), ['status', 'submission_id', 'submitted_at']);
  assert.equal(b.status, 'submitted');
});

test('POST con propiedades administrativas: 400 y nada se guarda', { skip: await noReal() }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { status: 'published', edition_id: crypto.randomUUID() })) });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'UNKNOWN_FIELDS');
});

test('POST con carrera inexistente: 422 INVALID_CAREER desde la base (no requiere catálogo real)', { skip }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload({ ...cat, careers: [], divisions: [] }, { career_ids: [crypto.randomUUID()] })) });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: string }).error, 'INVALID_CAREER');
});

test('POST Vida Universitaria sin carreras ni objetivo: 201 (no requiere catálogo real)', { skip }, async () => {
  const cat = await catalog();
  const vida = { activity_type: 'vida_universitaria', experience_category: 'deportiva', career_ids: [] };
  const base = payload({ ...cat, careers: [], divisions: [] }, vida) as Record<string, unknown>;
  delete base.objective;
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(base) });
  assert.equal(res.status, 201);
});

test('POST: reglas de categoría de experiencia y objetivo condicional (422 sin guardar)', { skip }, async () => {
  const cat = await catalog();
  const base = payload({ ...cat, careers: [{ career_id: crypto.randomUUID(), division_id: '' }], divisions: [] }) as Record<string, unknown>;
  const errors = async (body: Record<string, unknown>) => {
    const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.equal(res.status, 422);
    return ((await res.json()) as { errors: { field: string; code: string }[] }).errors.map((e) => `${e.field}:${e.code}`);
  };
  assert.ok((await errors({ ...base, experience_category: 'deportiva' })).includes('experience_category:NOT_ALLOWED'));
  const vida = { ...base, activity_type: 'vida_universitaria', career_ids: [] };
  assert.ok((await errors(vida)).includes('experience_category:REQUIRED'));
  assert.ok((await errors({ ...vida, experience_category: 'musical' })).includes('experience_category:INVALID_EXPERIENCE_CATEGORY'));
  const noObjective = { ...base } as Record<string, unknown>;
  delete noObjective.objective;
  assert.ok((await errors(noObjective)).includes('objective:REQUIRED'));
});

test('POST con validación de formulario: 422 con errores por campo', { skip: await noReal() }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { keywords: ['a', 'b'], session_duration_minutes: 45, career_ids: [] })) });
  assert.equal(res.status, 422);
  const b = (await res.json()) as { errors: { field: string; code: string }[] };
  assert.ok(b.errors.some((e) => e.field === 'keywords' && e.code === 'TOO_FEW_KEYWORDS'));
  assert.ok(b.errors.some((e) => e.field === 'career_ids' && e.code === 'CAREERS_REQUIRED'));
});

test('método, content-type, body y tamaño', { skip }, async () => {
  assert.equal((await fetch(URL_!, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(URL_!, { method: 'PUT', headers: json, body: '{}' })).status, 405);
  assert.equal((await fetch(URL_!, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
  assert.equal((await fetch(URL_!, { method: 'POST', headers: json, body: '{roto' })).status, 400);
  assert.equal((await fetch(URL_!, { method: 'POST', headers: json, body: '[]' })).status, 400);
  assert.equal((await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify({ notes: 'x'.repeat(40_000) }) })).status, 413);
  const opt = await fetch(URL_!, { method: 'OPTIONS' });
  assert.ok(opt.status === 204 || opt.status === 200);
  assert.match(opt.headers.get('access-control-allow-methods') ?? '', /POST/);
});
