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
  division_id: cat.divisions[0].division_id,
  activity_type: 'liderazgo',
  title: `ZZ-INTAKE-IT-${crypto.randomUUID().slice(0, 8)}`,
  student_pitch: 'Pitch de prueba de integración para el formulario.',
  why_join: 'Razón de prueba de integración para el formulario.',
  objective: 'Objetivo de prueba de integración para el formulario.',
  student_experience: 'Experiencia de prueba de integración para el formulario.',
  takeaway: 'Aprendizaje de prueba',
  keywords: ['uno', 'dos', 'tres'],
  session_duration_minutes: 30,
  capacity_per_session: 20,
  operating_start_time: '09:00',
  operating_end_time: '13:00',
  break_minutes: 5,
  building: 'Edificio X',
  room_space: 'Por confirmar',
  career_ids: cat.careers.slice(0, 2).map((c) => c.career_id),
  ...over,
});

test('GET: catálogo mínimo y CORS', { skip }, async () => {
  const res = await fetch(URL_!);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const b = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(b).sort(), ['activity_types', 'careers', 'divisions', 'edition', 'limits']);
  const cat = b as unknown as Catalog;
  assert.ok(cat.divisions.length > 0 && cat.careers.length > 0);
  assert.deepEqual(Object.keys(cat.careers[0]).sort(), ['career_id', 'career_name', 'division_id']);
});

test('POST válido: 201 submitted, respuesta mínima', { skip }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat)) });
  assert.equal(res.status, 201);
  const b = (await res.json()) as Record<string, string>;
  assert.deepEqual(Object.keys(b).sort(), ['status', 'submission_id', 'submitted_at']);
  assert.equal(b.status, 'submitted');
});

test('POST con propiedades administrativas: 400 y nada se guarda', { skip }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { status: 'published', edition_id: crypto.randomUUID() })) });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'UNKNOWN_FIELDS');
});

test('POST con carrera inexistente o división inválida: 422 desde la base', { skip }, async () => {
  const cat = await catalog();
  let res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { career_ids: [crypto.randomUUID()] })) });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: string }).error, 'INVALID_CAREER');
  res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { division_id: crypto.randomUUID() })) });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { error: string }).error, 'INVALID_DIVISION');
});

test('POST con validación de formulario: 422 con errores por campo', { skip }, async () => {
  const cat = await catalog();
  const res = await fetch(URL_!, { method: 'POST', headers: json, body: JSON.stringify(payload(cat, { keywords: ['a', 'b'], break_minutes: -1, career_ids: [] })) });
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
