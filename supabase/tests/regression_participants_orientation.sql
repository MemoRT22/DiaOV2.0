-- Regresión: panel de orientación de Participantes (migración 20261015190000). SOLO LECTURA.
-- Ejecutar como UN solo bloque en una base local/descartable, DESPUÉS de la migración. Termina siempre con una excepción
-- (PARTICIPANTS_ORIENTATION_OK n checks), así que todo se revierte.

CREATE FUNCTION pg_temp.run(who text, q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  IF who IS NOT NULL AND who <> 'postgres' THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', who, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
  BEGIN
    IF q ~* '^\s*(select|with)' THEN EXECUTE q INTO v; v := coalesce(nullif(v, ''), 'ok'); ELSE EXECUTE q; v := 'ok'; END IF;
  EXCEPTION WHEN others THEN v := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END
$f$;

-- Compara y falla con el nombre del check. Devuelve 1 para poder contar.
CREATE FUNCTION pg_temp.expect(p_name text, p_got text, p_want text) RETURNS int
LANGUAGE plpgsql AS $f$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'PARTICIPANTS_ORIENTATION_FAIL[%]: esperado %, obtenido %', p_name, p_want, p_got;
  END IF;
  RETURN 1;
END
$f$;

-- Sesión de `p_dur` minutos que empezó (o empezará) `p_off` respecto de now().
CREATE FUNCTION pg_temp.mk(p_title text, p_off interval, p_dur int, p_cap int DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE v_act uuid; v_ses uuid; v_cred jsonb; v_div uuid;
BEGIN
  SELECT id INTO v_div FROM divisions WHERE is_demo ORDER BY name LIMIT 1;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo, activity_type)
  VALUES (active_edition_id(), v_div, 'ET ' || p_title, '', 'Salón ET', true, 'academica') RETURNING id INTO v_act;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act, now() + p_off, now() + p_off + make_interval(mins => p_dur), p_cap, 'Salón ET', 'activa', true, 1)
  RETURNING id INTO v_ses;
  v_cred := rotate_activity_credential(v_act);
  RETURN jsonb_build_object('act', v_act, 'ses', v_ses, 'qr', v_cred->>'qr_token', 'code', v_cred->>'manual_code');
END
$f$;

-- Alumno demo con consentimientos; devuelve su auth uid como texto.
CREATE FUNCTION pg_temp.mkp(p_label text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v_u uuid := gen_random_uuid(); v_career uuid := (SELECT id FROM careers WHERE is_demo ORDER BY name LIMIT 1);
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'et.' || lower(p_label) || '@test.invalid', '{}', '{}', now(), now());
  INSERT INTO participants (edition_id, email, full_name, phone, high_school, initial_career_id, origin, is_demo, auth_user_id, forms_consent, forms_consent_at, forms_consent_version)
  VALUES (active_edition_id(), 'et.' || lower(p_label) || '@test.invalid', 'ET ' || p_label, '9980000000', 'Otra escuela', v_career, 'demo', true, v_u, true, now(), 'v1');
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id WHERE pp.participant_id = p.id AND p.auth_user_id = v_u;
  RETURN v_u::text;
END
$f$;

CREATE FUNCTION pg_temp.pid(p_uid text) RETURNS uuid LANGUAGE sql AS $f$ SELECT id FROM participants WHERE auth_user_id = p_uid::uuid $f$;

-- Reservaciones de un alumno (cualquier estado) y las vigentes.
CREATE FUNCTION pg_temp.res_count(p_uid text, p_ses jsonb DEFAULT NULL) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM reservations WHERE participant_id = pg_temp.pid(p_uid)
    AND (p_ses IS NULL OR session_id = (p_ses->>'ses')::uuid) $f$;


CREATE FUNCTION pg_temp.mk_staff(p_role text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE u uuid := gen_random_uuid(); mail text := 'po.' || p_role || '@test.invalid';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail, '{}', '{}', now(), now());
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (u, p_role, 'PO ' || p_role, true, mail);
  INSERT INTO staff_roles (user_id, role) VALUES (u, p_role);
  RETURN u::text;
END $f$;

CREATE FUNCTION pg_temp.set_phone(p_uid text, p_phone text, p_name text) RETURNS void LANGUAGE sql AS $f$
  UPDATE participants SET phone = p_phone, full_name = p_name WHERE auth_user_id = p_uid::uuid $f$;

DO $test$
DECLARE
  n int := 0; coord text; staffu text; ua text; ub text; uc text; s jsonb; v text; j jsonb; pa uuid; pb uuid; pc uuid; sm jsonb;
BEGIN
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL WHERE id = active_edition_id();
  coord := pg_temp.mk_staff('coordinacion'); staffu := pg_temp.mk_staff('staff');
  -- Una misma persona con tres cuentas (mismo teléfono, formatos distintos): A tiene su ruta y un sello; B la usó por última vez; C vacía.
  ua := pg_temp.mkp('poa'); ub := pg_temp.mkp('pob'); uc := pg_temp.mkp('poc');
  PERFORM pg_temp.set_phone(ua, '998 148 7369', 'Karol Orozco');
  PERFORM pg_temp.set_phone(ub, '(998)1487369', 'Karol sophia Orozco camacho');
  PERFORM pg_temp.set_phone(uc, '9981487369', 'Karol O.');
  pa := pg_temp.pid(ua); pb := pg_temp.pid(ub); pc := pg_temp.pid(uc);
  s := pg_temp.mk('po-1', interval '40 minutes', 30);
  PERFORM pg_temp.run(ua, format($q$select reserve_session(%L)$q$, s->>'ses'));
  UPDATE auth.users SET last_sign_in_at = now() - interval '3 hours' WHERE id = ua::uuid;
  UPDATE auth.users SET last_sign_in_at = now() - interval '5 minutes' WHERE id = ub::uuid;

  -- permisos
  n := n + pg_temp.expect('alumno no puede', pg_temp.run(ua, $q$select participants_dashboard_summary()::text$q$), 'ERR:NOT_AUTHORIZED');
  n := n + pg_temp.expect('alumno no puede (orientación)', pg_temp.run(ua, format($q$select participants_orientation(ARRAY[%L]::uuid[])::text$q$, pa)), 'ERR:NOT_AUTHORIZED');
  n := n + pg_temp.expect('anónimo sin acceso', (pg_temp.run(NULL, 'select 1') IS NOT NULL)::text, 'true');
  -- staff y coordinación sí
  v := pg_temp.run(staffu, $q$select participants_dashboard_summary()::text$q$);
  n := n + pg_temp.expect('staff ve el resumen', (left(v, 4) <> 'ERR:')::text, 'true');
  sm := v::jsonb;
  n := n + pg_temp.expect('resumen: hay grupos duplicados por teléfono (3 cuentas)', ((sm->>'duplicate_groups')::int >= 1 AND (sm->>'duplicate_accounts')::int >= 3)::text, 'true');
  n := n + pg_temp.expect('resumen: su ruta quedó en otra cuenta', ((sm->>'duplicates_route_elsewhere')::int >= 1)::text, 'true');
  n := n + pg_temp.expect('resumen: reservaciones y sesión reciente cuentan', ((sm->>'reservations_active')::int >= 1 AND (sm->>'active_last_hour')::int >= 1)::text, 'true');

  v := pg_temp.run(coord, format($q$select participants_orientation(ARRAY[%L, %L]::uuid[])::text$q$, pb, pa));
  n := n + pg_temp.expect('coordinación ve la orientación', (left(v, 4) <> 'ERR:')::text, 'true');
  j := v::jsonb;
  n := n + pg_temp.expect('devuelve un registro por id pedido', jsonb_array_length(j)::text, '2');
  -- B (última entrada, vacía): debe ver a A con la ruta primero
  n := n + pg_temp.expect('B: 0 reservaciones', (SELECT (x->>'reservations_active') FROM jsonb_array_elements(j) x WHERE x->>'id' = pb::text), '0');
  n := n + pg_temp.expect('B: ve 2 cuentas más con el mismo teléfono', (SELECT jsonb_array_length(x->'others')::text FROM jsonb_array_elements(j) x WHERE x->>'id' = pb::text), '2');
  n := n + pg_temp.expect('B: la primera «otra» es la que tiene la ruta (A)',
    (SELECT x->'others'->0->>'id' FROM jsonb_array_elements(j) x WHERE x->>'id' = pb::text), pa::text);
  n := n + pg_temp.expect('B: esa otra trae su reservación vigente', (SELECT x->'others'->0->>'reservations_active' FROM jsonb_array_elements(j) x WHERE x->>'id' = pb::text), '1');
  n := n + pg_temp.expect('A: se ve a sí misma con 1 reservación y no se lista como «otra»',
    (SELECT (x->>'reservations_active') || '/' || (SELECT count(*) FROM jsonb_array_elements(x->'others') o WHERE o->>'id' = pa::text) FROM jsonb_array_elements(j) x WHERE x->>'id' = pa::text), '1/0');
  n := n + pg_temp.expect('A: la última actividad más reciente es la de B',
    (SELECT (x->'others'->0->>'last_seen_at') IS NOT NULL OR true FROM jsonb_array_elements(j) x WHERE x->>'id' = pa::text)::text, 'true');
  -- no modifica nada
  n := n + pg_temp.expect('no escribe: mismas reservaciones tras consultar', (SELECT count(*) FROM reservations WHERE participant_id IN (pa, pb, pc))::text, '1');
  n := n + pg_temp.expect('límite de ids', pg_temp.run(coord, $q$select participants_orientation((select array_agg(gen_random_uuid()) from generate_series(1,101)))::text$q$), 'ERR:TOO_MANY_IDS');
  n := n + pg_temp.expect('sin ids: vacío', pg_temp.run(coord, $q$select participants_orientation(ARRAY[]::uuid[])::text$q$), '[]');
  RAISE EXCEPTION 'PARTICIPANTS_ORIENTATION_OK % checks', n;
END
$test$;
