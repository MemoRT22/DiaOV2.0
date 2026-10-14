#!/usr/bin/env node
// Generador de DATOS FICTICIOS para la prueba de carga. No se conecta a nada: escribe archivos que TÚ aplicas a un entorno AISLADO.
//   data/users.json     padrón ficticio (correo, nombre, contraseña) que lee k6
//   data/seed.sql       siembra el entorno de pruebas (cuentas de Auth, participantes DEMO, talleres con cupo limitado, credenciales)
//   data/cleanup.sql    retira todo lo sembrado
//   data/reset-run.sql  borra solo lo que generó una corrida (reservaciones, asistencias, encuestas) y restaura las reservaciones previas
//   data/dataset.meta.json  parámetros usados (sin la contraseña)
// Uso: node tools/generate-data.mjs --users 2000 --seed 15102026 --bcrypt-cost 10
// Todo es determinista salvo la contraseña, que se genera al azar en cada corrida del generador y NO se versiona (data/ está en .gitignore).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : pairs), []));
const num = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));

export const OPTIONS = {
  users: num('users', 2000),
  seed: num('seed', 15102026),
  bcryptCost: num('bcrypt-cost', 10),
  normalWorkshops: num('workshops', 56),
  hotSessions: 8,
  checkinActivities: num('checkin-activities', 12),
  rtSessions: 4,
  out: resolve(here, '..', args.out || 'data'),
  prefix: args.prefix || 'lt',
  domain: args.domain || 'loadtest.invalid',
};
const HOT_CAPACITIES = [5, 10, 15, 20, 25, 30, 40, 50];

// ── PRNG determinista ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mulberry32(OPTIONS.seed);
const choice = (items) => items[Math.floor(rand() * items.length)];

const FIRST = ['Ana', 'Luis', 'María', 'Carlos', 'Valeria', 'Diego', 'Camila', 'José', 'Regina', 'Emiliano', 'Daniela', 'Mateo', 'Sofía', 'Santiago', 'Renata', 'Leonardo', 'Isabella', 'Sebastián', 'Fernanda', 'Andrés', 'Paola', 'Iván', 'Ximena', 'Rodrigo', 'Natalia', 'Gael', 'Mariana', 'Héctor', 'Alejandra', 'Pablo'];
const LAST = ['García', 'Hernández', 'López', 'Martínez', 'González', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Morales', 'Vázquez', 'Jiménez', 'Reyes', 'Torres', 'Díaz', 'Gutiérrez', 'Ortiz', 'Chan', 'Pech', 'May', 'Cauich', 'Tun', 'Canul'];
const SUBJECTS = ['Robótica', 'Primeros auxilios', 'Derecho penal en acción', 'Finanzas personales', 'Diseño arquitectónico', 'Marketing digital', 'Nutrición deportiva', 'Psicología del aprendizaje', 'Programación creativa', 'Relaciones internacionales', 'Liderazgo en equipo', 'Fotografía', 'Biología marina', 'Negocios sostenibles', 'Comunicación audiovisual', 'Ingeniería civil', 'Medicina del deporte', 'Gastronomía molecular', 'Realidad virtual', 'Ciencia de datos'];

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;
const pad = (n, width) => String(n).padStart(width, '0');
const PASSWORD = `LT-${randomBytes(12).toString('base64url')}`;

export function buildUsers() {
  const width = Math.max(4, String(OPTIONS.users).length);
  return Array.from({ length: OPTIONS.users }, (_, index) => ({
    index,
    email: `${OPTIONS.prefix}.${pad(index + 1, width)}@${OPTIONS.domain}`,
    name: `${choice(FIRST)} ${choice(LAST)} ${choice(LAST)} (prueba ${pad(index + 1, width)})`,
    password: PASSWORD,
  }));
}

/** Reparto del padrón cuando todos los recorridos corren juntos: nadie hace dos cosas a la vez. El check-in usa quien tiene reservaciones previas. */
export function buildCohorts(n) {
  const at = (from, to) => ({ base: Math.floor(n * from), size: Math.max(1, Math.floor(n * to) - Math.floor(n * from)) });
  // Deben ser disjuntas: en la corrida integral una cuenta representa a una sola persona y ejecuta un solo recorrido.
  // Las proporciones coinciden exactamente con 99-full-day.js (55 % + 25 % + 8 % + 6 % + 6 % = 100 %).
  return {
    navigation: at(0, 0.55),
    reservations: at(0.55, 0.80),
    checkin: at(0.80, 0.88),
    survey: at(0.88, 0.94),
    realtime: at(0.94, 1),
  };
}

// ── Plan de talleres ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function buildPlan() {
  const activities = [];
  const add = (set, n, title, type, capacities, slots, durationMin) => activities.push({ set, n, title, type, capacities, slots, durationMin });
  for (let k = 0; k < OPTIONS.hotSessions; k += 1) add('hot', k + 1, `LT HOT ${pad(k + 1, 2)} ${SUBJECTS[k % SUBJECTS.length]}`, k % 2 ? 'academica' : 'vida_universitaria', [HOT_CAPACITIES[k % HOT_CAPACITIES.length]], [(k % 4) * 30], 60);
  for (let k = 0; k < OPTIONS.normalWorkshops; k += 1) {
    const caps = [30, 40, 60];
    add('normal', k + 1, `LT NORMAL ${pad(k + 1, 2)} ${SUBJECTS[(k + 3) % SUBJECTS.length]}`, k % 5 === 0 ? 'vida_universitaria' : 'academica', caps, [180, 270, 360], 60);
  }
  for (let k = 0; k < OPTIONS.checkinActivities; k += 1) add('checkin', k + 1, `LT CHECKIN ${pad(k + 1, 2)} ${SUBJECTS[(k + 7) % SUBJECTS.length]}`, k % 3 === 0 ? 'vida_universitaria' : 'academica', [800], [60 + k * 20], 60);
  for (let k = 0; k < OPTIONS.rtSessions; k += 1) add('rt', k + 1, `LT RT ${pad(k + 1, 2)} ${SUBJECTS[(k + 11) % SUBJECTS.length]}`, 'academica', [Math.max(2000, OPTIONS.users)], [420 + k * 70], 60);
  return activities;
}

// ── SQL ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const GUARD = `
-- ============================================================================================================================
-- DATOS FICTICIOS PARA PRUEBAS DE CARGA. Solo para un entorno AISLADO (local o un proyecto de pruebas). NUNCA producción.
-- Se niega a correr si: no confirmas con -v confirm_isolated=YES; la edición no está en «preparacion»; o existe CUALQUIER participante
-- real (no DEMO). Toda cuenta sembrada usa el dominio reservado @${OPTIONS.domain} y todo taller el prefijo «LT ».
-- ============================================================================================================================
\\set ON_ERROR_STOP on
SELECT set_config('loadtest.confirm', :'confirm_isolated', false) AS _confirmed \\gset
DO $guard$
BEGIN
  IF current_setting('loadtest.confirm', true) IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'Confirma que es un entorno AISLADO: psql -v confirm_isolated=YES'; END IF;
  IF NOT EXISTS (SELECT 1 FROM editions WHERE is_active) THEN RAISE EXCEPTION 'No hay una edición activa'; END IF;
  IF (SELECT mode FROM editions WHERE is_active) <> 'preparacion' THEN RAISE EXCEPTION 'La edición no está en preparación: este NO parece un entorno de pruebas'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE NOT is_demo) THEN RAISE EXCEPTION 'Hay participantes REALES (no DEMO) en esta base: se rechaza. Usa un proyecto de pruebas sin datos reales.'; END IF;
END
$guard$;
`;

const CLEANUP_BODY = `
DELETE FROM participants WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}';       -- cascada: perfiles, reservaciones, asistencias, encuestas, invitaciones
DO $c$
BEGIN
  IF to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE $q$DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}')$q$;
  END IF;
  DELETE FROM auth.users WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}';
END $c$;
DELETE FROM attendances WHERE activity_id IN (SELECT id FROM activities WHERE title LIKE 'LT %');
DELETE FROM reservations WHERE activity_id IN (SELECT id FROM activities WHERE title LIKE 'LT %');
DELETE FROM activity_credentials WHERE activity_id IN (SELECT id FROM activities WHERE title LIKE 'LT %');
DELETE FROM activity_sessions WHERE activity_id IN (SELECT id FROM activities WHERE title LIKE 'LT %');
DELETE FROM activities WHERE title LIKE 'LT %';
DELETE FROM divisions WHERE code = 'lt-div';
`;

function prebookSql() {
  // Todas las personas reciben 2 reservaciones previas: así 05-checkin puede llegar a 2,000 cuentas distintas. En la corrida integral
  // solo usa su cohorte disjunta. Las actividades tienen capacidad >= padrón y cada persona queda debajo del máximo de la edición.
  const n = OPTIONS.checkinActivities;
  return `
INSERT INTO reservations (participant_id, session_id, activity_id)
SELECT p.id, s.id, s.activity_id
FROM (SELECT p.id, substring(p.email from '^${OPTIONS.prefix}\\.([0-9]+)@')::int - 1 AS idx FROM participants p WHERE p.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}') p
JOIN LATERAL (SELECT unnest(ARRAY[(p.idx * 3) % ${n}, ((p.idx * 3) % ${n} + 5) % ${n}]) AS k) pick ON true
JOIN activities a ON a.title LIKE 'LT CHECKIN ' || lpad((pick.k + 1)::text, 2, '0') || '%'
JOIN activity_sessions s ON s.activity_id = a.id
ON CONFLICT DO NOTHING;`;
}

export function seedSql(users, plan, cohorts) {
  const usersJson = JSON.stringify(users.map((u) => ({ idx: u.index, email: u.email, name: u.name })));
  const stamps = (a) => a.slots.map((offset) => `(${sqlText(a.title)}, ${a.n}, ${sqlText(a.set)}, ${sqlText(a.type)}, ${offset}, ${a.durationMin})`);
  const activityRows = plan.map((a) => `(${sqlText(a.set)}, ${a.n}, ${sqlText(a.title)}, ${sqlText(a.type)}, ARRAY[${a.slots.join(',')}], ARRAY[${a.capacities.join(',')}], ${a.durationMin})`).join(',\n    ');
  void stamps;
  return `${GUARD}
BEGIN;
-- Idempotente: si ya había datos de pruebas de carga, se retiran primero.
${CLEANUP_BODY}

-- Ventanas abiertas para que reservaciones y encuesta sean ejercitables en el entorno efímero de carga.
UPDATE editions SET reservations_open_at = now() - interval '1 day', reservations_close_at = now() + interval '30 days',
  exit_survey_opens_at = now() - interval '1 day'
WHERE is_active;

INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('lt-div', 'LT División de prueba de carga', 9990, true);

-- Cuentas de Supabase Auth con contraseña real (bcrypt), correo confirmado y los campos de texto en '' (GoTrue falla con NULL).
DO $users$
DECLARE
  ed uuid := (SELECT id FROM editions WHERE is_active);
  ver text := (SELECT privacy_notice_version FROM editions WHERE is_active);
  pwd text := ${sqlText(PASSWORD)};
  cost int := ${OPTIONS.bcryptCost};
  src jsonb := ${sqlText(usersJson)}::jsonb;
  optional text[] := ARRAY['email_confirmed_at','confirmed_at','confirmation_token','recovery_token','email_change_token_new','email_change','email_change_token_current','phone_change','phone_change_token','reauthentication_token'];
  cols text := 'id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at';
  vals text := $v$md5('${OPTIONS.prefix}-user-' || t.idx)::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', t.email,
      extensions.crypt($1, extensions.gen_salt('bf', $2)), '{"provider":"email","providers":["email"],"kind":"participant"}'::jsonb, jsonb_build_object('full_name', t.name), now(), now()$v$;
  col text;
BEGIN
  FOREACH col IN ARRAY optional LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = col AND is_generated = 'NEVER') THEN
      cols := cols || ', ' || col;
      vals := vals || CASE WHEN col IN ('email_confirmed_at','confirmed_at') THEN ', now()' ELSE ', ''''' END;
    END IF;
  END LOOP;
  EXECUTE format('INSERT INTO auth.users (%s) SELECT %s FROM jsonb_to_recordset($3) AS t(idx int, email text, name text)', cols, vals) USING pwd, cost, src;

  IF to_regclass('auth.identities') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id') THEN
      EXECUTE $i$INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()
        FROM auth.users u WHERE u.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}'$i$;
    ELSE
      EXECUTE $i$INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
        FROM auth.users u WHERE u.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}'$i$;
    END IF;
  END IF;

  -- Participantes DEMO (datos de ensayo) con Aviso de Privacidad aceptado.
  INSERT INTO participants (id, edition_id, email, full_name, origin, is_demo, auth_user_id)
  SELECT md5('${OPTIONS.prefix}-participant-' || t.idx)::uuid, ed, t.email, t.name, 'demo', true, md5('${OPTIONS.prefix}-user-' || t.idx)::uuid
  FROM jsonb_to_recordset(src) AS t(idx int, email text, name text);
  INSERT INTO participant_profiles (participant_id, auth_user_id, display_name)
  SELECT p.id, p.auth_user_id, p.full_name FROM participants p WHERE p.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}'
  ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name, auth_user_id = EXCLUDED.auth_user_id;
  UPDATE participant_profiles pp SET platform_consent_version = ver, platform_consent_at = now()
  FROM participants p WHERE pp.participant_id = p.id AND p.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}';
END
$users$;

-- Talleres y sesiones con cupo limitado (relativos a «ahora», para que las reservaciones sigan siendo válidas durante la prueba).
CREATE TEMP TABLE lt_creds (activity_id uuid PRIMARY KEY, qr text NOT NULL, code text NOT NULL) ON COMMIT DROP;
DO $plan$
DECLARE
  ed uuid := (SELECT id FROM editions WHERE is_active);
  div uuid := (SELECT id FROM divisions WHERE code = 'lt-div');
  base timestamptz := date_trunc('hour', now()) + interval '1 hour';
  r record; a uuid; i int; c jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ${activityRows}
  ) AS t(set_name, n, title, type, slots, caps, duration) LOOP
    INSERT INTO activities (id, edition_id, division_id, title, is_demo, activity_type, experience_category)
    VALUES (md5('${OPTIONS.prefix}-activity-' || r.title)::uuid, ed, div, r.title, true, r.type, CASE WHEN r.type = 'vida_universitaria' THEN 'otra' END) RETURNING id INTO a;
    FOR i IN 1..array_length(r.slots, 1) LOOP
      INSERT INTO activity_sessions (id, activity_id, starts_at, ends_at, capacity, is_demo, status)
      VALUES (md5('${OPTIONS.prefix}-session-' || r.title || '-' || i)::uuid, a, base + make_interval(mins => r.slots[i]), base + make_interval(mins => r.slots[i] + r.duration),
              r.caps[LEAST(i, array_length(r.caps, 1))], true, 'activa');
    END LOOP;
    IF r.set_name = 'checkin' THEN
      c := rotate_activity_credential(a);
      INSERT INTO lt_creds VALUES (a, c->>'qr_token', c->>'manual_code');
    END IF;
  END LOOP;
END
$plan$;
${prebookSql()}

-- Manifiesto para k6 (lo ÚNICO que sale por stdout; redirígelo: psql -q -At -f seed.sql -o manifest.json).
SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'users', jsonb_build_object('count', ${OPTIONS.users}, 'prefix', '${OPTIONS.prefix}', 'domain', '${OPTIONS.domain}'),
  'cohorts', ${sqlText(JSON.stringify(cohorts))}::jsonb,
  'edition', (SELECT jsonb_build_object('id', e.id, 'mode', e.mode, 'max_reservations', e.max_reservations, 'reservations_open_at', e.reservations_open_at) FROM editions e WHERE e.is_active),
  'sessions', (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'activity_id', s.activity_id, 'title', a.title, 'set', lower(split_part(a.title, ' ', 2)),
      'capacity', s.capacity, 'starts_at', s.starts_at, 'ends_at', s.ends_at) ORDER BY a.title, s.starts_at)
    FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title LIKE 'LT %'),
  'credentials', (SELECT coalesce(jsonb_agg(jsonb_build_object('activity_id', activity_id, 'qr', qr, 'code', code)), '[]'::jsonb) FROM lt_creds),
  'bookings', (SELECT coalesce(jsonb_object_agg(idx::text, b), '{}'::jsonb) FROM (
      SELECT (substring(p.email from '^${OPTIONS.prefix}\\.([0-9]+)@')::int - 1) AS idx, jsonb_agg(jsonb_build_object('activity_id', r.activity_id, 'session_id', r.session_id)) AS b
      FROM reservations r JOIN participants p ON p.id = r.participant_id WHERE p.email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}' GROUP BY 1) x)
));
COMMIT;
`;
}

export function cleanupSql() {
  return `${GUARD}
BEGIN;
${CLEANUP_BODY}
COMMIT;
`;
}

export function resetRunSql() {
  return `${GUARD}
BEGIN;
-- Borra SOLO lo que generó una corrida y deja el estado inicial sembrado (reservaciones previas del check-in incluidas).
DELETE FROM attendances WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}');
DELETE FROM reservations WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}');
DELETE FROM exit_survey_invitations WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}');
DELETE FROM exit_survey_responses WHERE participant_id IN (SELECT id FROM participants WHERE email LIKE '${OPTIONS.prefix}.%@${OPTIONS.domain}');
${prebookSql()}
COMMIT;
`;
}

function main() {
  const users = buildUsers();
  const plan = buildPlan();
  const cohorts = buildCohorts(users.length);
  mkdirSync(OPTIONS.out, { recursive: true });
  writeFileSync(join(OPTIONS.out, 'users.json'), JSON.stringify(users));
  writeFileSync(join(OPTIONS.out, 'seed.sql'), seedSql(users, plan, cohorts));
  writeFileSync(join(OPTIONS.out, 'cleanup.sql'), cleanupSql());
  writeFileSync(join(OPTIONS.out, 'reset-run.sql'), resetRunSql());
  writeFileSync(join(OPTIONS.out, 'dataset.meta.json'), JSON.stringify({ users: users.length, seed: OPTIONS.seed, bcryptCost: OPTIONS.bcryptCost, cohorts, activities: plan.length, hot: plan.filter((a) => a.set === 'hot').map((a) => ({ title: a.title, capacity: a.capacities[0] })) }, null, 2));
  console.log(`Datos ficticios en ${OPTIONS.out}: ${users.length} personas, ${plan.length} talleres (${plan.filter((a) => a.set === 'hot').length} «calientes» con cupo ${HOT_CAPACITIES.join('/')}). La contraseña común está en users.json (no se versiona).`);
  console.log('Siguiente paso (entorno AISLADO): psql "$DATABASE_URL" -q -At -v ON_ERROR_STOP=1 -v confirm_isolated=YES -f data/seed.sql -o data/manifest.json');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
