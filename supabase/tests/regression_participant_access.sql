-- Regression tests for password access / self-service registration (domain: participants, import, reset).
-- Run the whole file as ONE statement against a database that has migration 20261006191413 applied
-- (the contract migration 20261007030100 is optional: the checks that depend on it adapt via `retired`).
-- Fixtures are created inside the statement; it ALWAYS ends by raising an exception, so every change is rolled back.
-- Success is read from the message: "PARTICIPANT_ACCESS_OK n checks". The preparation reset is never executed:
-- identity selection is verified through its read-only helper and the preview.

CREATE FUNCTION pg_temp.run(who text, q text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  IF who = 'anon' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    PERFORM set_config('role', 'anon', true);
  ELSIF who = 'service' THEN
    PERFORM set_config('role', 'service_role', true);
  ELSIF who IS NOT NULL AND who <> 'postgres' THEN
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

CREATE FUNCTION pg_temp.j(t text) RETURNS jsonb LANGUAGE plpgsql AS $f$
BEGIN
  IF t LIKE 'ERR:%' THEN RAISE EXCEPTION 'RUN_FAILED[%]', t; END IF;
  RETURN t::jsonb;
END
$f$;

DO $test$
DECLARE
  ed uuid := active_edition_id();
  ver text := (SELECT privacy_notice_version FROM editions WHERE id = active_edition_id());
  c text := gen_random_uuid()::text;     -- coordinación
  s text := gen_random_uuid()::text;     -- staff
  r text := gen_random_uuid()::text;     -- sorteo
  u1 text := gen_random_uuid()::text;    -- identidad real de participante
  u2 text := gen_random_uuid()::text;    -- identidad sintética antigua
  u3 text := gen_random_uuid()::text;    -- identidad de Staff vinculada por error a un participante
  u4 text := gen_random_uuid()::text;    -- identidad sin marca de participante
  u5 text := gen_random_uuid()::text;    -- sesión de un participante autorregistrado
  career uuid; career2 uuid; demo_career uuid; school_id uuid;
  pid uuid; pid2 uuid; p_forms uuid; p_syn uuid; p_staff uuid; p_other uuid; p_self uuid;
  v_n int := 0; v text; j jsonb; retired boolean := to_regprocedure('public.access_lock_state(text)') IS NULL;
  payload jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, x.meta::jsonb, '{}', now(), now()
  FROM (VALUES
    (c, 'pa.coord@test.invalid', '{}'), (s, 'pa.staff@test.invalid', '{}'), (r, 'pa.sorteo@test.invalid', '{}'),
    (u1, 'pa.real@test.invalid', '{"kind":"participant"}'),
    (u2, 'p.00000000-0000-4000-8000-0000000000aa@participantes.diaov.invalid', '{"kind":"participant"}'),
    (u3, 'pa.staffident@test.invalid', '{"kind":"participant"}'),
    (u4, 'pa.nokind@test.invalid', '{}'),
    (u5, 'pa.self@test.invalid', '{"kind":"participant"}')) AS x(id, email, meta);
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c::uuid, 'coordinacion', 'PA Coord', true, 'pa.coord@test.invalid'), (s::uuid, 'staff', 'PA Staff', true, 'pa.staff@test.invalid'),
    (r::uuid, 'sorteo', 'PA Sorteo', true, 'pa.sorteo@test.invalid'), (u3::uuid, 'staff', 'PA Staff Ident', true, 'pa.staffident@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c::uuid, 'coordinacion'), (s::uuid, 'staff'), (r::uuid, 'sorteo'), (u3::uuid, 'staff');
  UPDATE editions SET roster_status = 'preparacion', roster_declared_at = NULL WHERE id = ed;

  SELECT id INTO career FROM careers WHERE is_active AND NOT is_demo ORDER BY code LIMIT 1;
  SELECT id INTO career2 FROM careers WHERE is_active AND NOT is_demo AND id <> career ORDER BY code LIMIT 1;
  IF career IS NULL OR career2 IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_REAL_CAREERS'; END IF;
  SELECT id INTO school_id FROM high_schools WHERE name = 'Otra escuela' AND is_active;
  IF school_id IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_OTHER_SCHOOL'; END IF;
  INSERT INTO careers (code, name, division_id, is_demo, is_active)
  SELECT 'PA-DEMO', 'PA Demo', division_id, true, true FROM careers WHERE id = career RETURNING id INTO demo_career;

  payload := jsonb_build_object('email', 'Ana.Self@Test.invalid ', 'first_name', ' Ana  María ', 'last_name', 'López Pérez',
    'phone', '998 123 4567', 'high_school_id', school_id, 'high_school_grade', '3', 'entry_period', '2027-08',
    'initial_career_id', career::text, 'consent_accepted', true);

  -- ===== 1. Permisos: las funciones internas son solo de service_role =====
  FOR v IN SELECT unnest(ARRAY['participant_access_state_internal(text)', 'register_self_service_internal(jsonb)',
      'participant_link_auth_internal(uuid, uuid)', 'discard_self_service_registration_internal(uuid)',
      'participant_password_audit_internal(uuid, uuid)', 'preparation_participant_auth_ids(uuid)']) LOOP
    IF has_function_privilege('anon', 'public.' || v, 'EXECUTE') OR has_function_privilege('authenticated', 'public.' || v, 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.' || v, 'EXECUTE') THEN RAISE EXCEPTION 'GRANTS_WRONG[%]', v; END IF;
  END LOOP;
  IF pg_temp.run('anon', $q$select participant_access_state_internal('a@b.co')$q$) NOT LIKE 'ERR:%permission denied%'
     OR pg_temp.run(c, $q$select register_self_service_internal('{}'::jsonb)$q$) NOT LIKE 'ERR:%permission denied%' THEN RAISE EXCEPTION 'INTERNALS_CALLABLE_BY_CLIENT'; END IF;
  v_n := v_n + 2;

  -- ===== 2. Estado del correo =====
  IF pg_temp.run('service', $q$select participant_access_state_internal('nadie@test.invalid')$q$) <> 'self_registration' THEN RAISE EXCEPTION 'STATE_SELF_REGISTRATION'; END IF;
  IF pg_temp.run('service', $q$select participant_access_state_internal('no es un correo')$q$) NOT LIKE 'ERR:INVALID_EMAIL' THEN RAISE EXCEPTION 'STATE_INVALID_EMAIL'; END IF;
  INSERT INTO participants (edition_id, email, full_name, phone, origin, initial_career_id)
  VALUES (ed, 'pa.forms@test.invalid', 'Forms Prerregistrado', '9981112233', 'forms', career) RETURNING id INTO p_forms;
  IF pg_temp.run('service', $q$select participant_access_state_internal(' PA.Forms@Test.invalid ')$q$) <> 'password_setup' THEN RAISE EXCEPTION 'STATE_PASSWORD_SETUP'; END IF;
  v_n := v_n + 3;
  -- el estado nunca devuelve datos personales: solo uno de tres valores
  IF pg_temp.run('service', $q$select participant_access_state_internal('pa.forms@test.invalid') in ('password_login','password_setup','self_registration')$q$) <> 'true' THEN RAISE EXCEPTION 'STATE_LEAKS'; END IF;
  v_n := v_n + 1;

  -- ===== 3. Vincular identidad: crear la contraseña por primera vez =====
  IF pg_temp.run('service', format($q$select participant_link_auth_internal(%L, %L)$q$, p_forms, u1)) <> 'ok' THEN RAISE EXCEPTION 'LINK_FAILED'; END IF;
  IF (SELECT auth_user_id FROM participants WHERE id = p_forms) <> u1::uuid OR (SELECT password_configured_at FROM participants WHERE id = p_forms) IS NULL THEN RAISE EXCEPTION 'LINK_NOT_SAVED'; END IF;
  IF pg_temp.run('service', $q$select participant_access_state_internal('pa.forms@test.invalid')$q$) <> 'password_login' THEN RAISE EXCEPTION 'STATE_PASSWORD_LOGIN'; END IF;
  IF pg_temp.run('service', format($q$select participant_link_auth_internal(%L, %L)$q$, gen_random_uuid(), u1)) <> 'ERR:NOT_FOUND' THEN RAISE EXCEPTION 'LINK_UNKNOWN_PARTICIPANT'; END IF;
  v_n := v_n + 4;

  -- ===== 4. Autorregistro =====
  v := pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, payload));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'REGISTER_FAILED[%]', v; END IF;
  pid := v::uuid;
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = pid AND email = 'ana.self@test.invalid' AND full_name = 'Ana María López Pérez'
      AND origin = 'self_service' AND NOT is_demo AND phone = '9981234567' AND high_school = 'Otra escuela' AND high_school_id = school_id
      AND high_school_grade = '3' AND entry_period = '2027-08' AND initial_career_id = career
      AND auth_user_id IS NULL AND password_configured_at IS NULL AND (to_jsonb(participants)->>'birth_date') IS NULL) THEN RAISE EXCEPTION 'SELF_SERVICE_FIELDS'; END IF;
  IF NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pid AND preference = 1 AND career_id = career)
     OR EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pid AND preference > 1) THEN RAISE EXCEPTION 'SELF_SERVICE_INTEREST'; END IF;
  IF NOT EXISTS (SELECT 1 FROM participant_profiles WHERE participant_id = pid AND platform_consent_at IS NOT NULL
      AND platform_consent_version = ver AND platform_consent_source = 'self_service') THEN RAISE EXCEPTION 'SELF_SERVICE_CONSENT'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE id = pid AND (forms_consent IS NOT NULL OR manual_consent_at IS NOT NULL)) THEN RAISE EXCEPTION 'SELF_SERVICE_MIXED_CONSENT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'participant.self_registered' AND detail = jsonb_build_object('participant_id', pid)) THEN RAISE EXCEPTION 'SELF_SERVICE_AUDIT'; END IF;
  v_n := v_n + 5;
  -- el correo ya existe: no se crea un segundo participante (también con otras mayúsculas)
  IF pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, payload)) <> 'ERR:EMAIL_EXISTS'
     OR pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, payload || '{"email":"PA.FORMS@test.invalid"}')) <> 'ERR:EMAIL_EXISTS' THEN RAISE EXCEPTION 'DUPLICATE_ACCEPTED'; END IF;
  IF (SELECT count(*) FROM participants WHERE edition_id = ed AND email IN ('ana.self@test.invalid', 'pa.forms@test.invalid')) <> 2 THEN RAISE EXCEPTION 'DUPLICATE_CREATED'; END IF;
  v_n := v_n + 2;
  -- validaciones
  FOREACH v IN ARRAY ARRAY['{"consent_accepted":false}', '{"consent_accepted":null}', '{"high_school_grade":"4"}', '{"high_school_grade":""}',
      '{"entry_period":"2026-01"}', '{"entry_period":null}', '{"phone":""}', '{"phone":"123"}', '{"high_school_id":"00000000-0000-0000-0000-000000000000"}', '{"last_name":""}',
      '{"first_name":""}', '{"email":"sin-arroba"}', '{"initial_career_id":"00000000-0000-0000-0000-000000000000"}', '{"initial_career_id":null}'] LOOP
    IF pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, (payload || '{"email":"pa.valida@test.invalid"}')::jsonb || v::jsonb)) NOT LIKE 'ERR:%' THEN
      RAISE EXCEPTION 'VALIDATION_ACCEPTED[%]', v; END IF;
  END LOOP;
  IF pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, (payload - 'consent_accepted') || '{"email":"pa.valida@test.invalid"}')) <> 'ERR:CONSENT_REQUIRED' THEN RAISE EXCEPTION 'CONSENT_NOT_REQUIRED'; END IF;
  IF pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, payload || jsonb_build_object('email', 'pa.valida@test.invalid', 'initial_career_id', demo_career))) <> 'ERR:INVALID_CAREER' THEN RAISE EXCEPTION 'DEMO_CAREER_ACCEPTED'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE email = 'pa.valida@test.invalid') THEN RAISE EXCEPTION 'INVALID_REGISTRATION_PERSISTED'; END IF;
  v_n := v_n + 3;
  -- compensación: solo descarta un autorregistro sin cuenta; jamás un registro terminado ni de otro origen
  IF pg_temp.run('service', format($q$select discard_self_service_registration_internal(%L)$q$, p_forms)) <> 'false' THEN RAISE EXCEPTION 'DISCARD_REMOVED_FORMS'; END IF;
  IF pg_temp.run('service', format($q$select discard_self_service_registration_internal(%L)$q$, pid)) <> 'true' THEN RAISE EXCEPTION 'DISCARD_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE id = pid) OR EXISTS (SELECT 1 FROM participant_profiles WHERE participant_id = pid)
     OR EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pid) THEN RAISE EXCEPTION 'DISCARD_LEFT_ROWS'; END IF;
  v := pg_temp.run('service', format($q$select register_self_service_internal(%L::jsonb)$q$, payload)); pid := v::uuid;
  PERFORM participant_link_auth_internal(pid, u5::uuid);
  IF pg_temp.run('service', format($q$select discard_self_service_registration_internal(%L)$q$, pid)) <> 'false' THEN RAISE EXCEPTION 'DISCARD_REMOVED_LINKED'; END IF;
  v_n := v_n + 4;

  -- ===== 5. El autorregistrado entra con el consentimiento ya satisfecho =====
  j := (SELECT pg_temp.run(u5, 'select my_progress()')::jsonb);
  IF (j->>'consent_accepted') <> 'true' THEN RAISE EXCEPTION 'SELF_SERVICE_CONSENT_NOT_SATISFIED'; END IF;
  v := pg_temp.run(u5, 'select accept_platform_notice()');
  IF v <> 'ok' OR (SELECT platform_consent_source FROM participant_profiles WHERE participant_id = pid) IS DISTINCT FROM 'platform' THEN
    RAISE EXCEPTION 'ACCEPT_SOURCE[%]', v; END IF;
  v_n := v_n + 2;

  -- ===== 6. Importación del Forms oficial =====
  v := pg_temp.run(c, format($q$select commit_participant_import(%L::jsonb, 'forms.csv', false)$q$, jsonb_build_array(
    jsonb_build_object('row', 2, 'email', 'pa.imp@test.invalid', 'full_name', 'Beto Ruiz Díaz', 'phone', '9985551234', 'high_school', 'Otra escuela',
      'high_school_grade', 'graduado', 'entry_period', '2028-01', 'career', (SELECT code FROM careers WHERE id = career)),
    jsonb_build_object('row', 3, 'email', 'pa.imp2@test.invalid', 'full_name', 'Carla Soto', 'high_school_grade', 'quinto', 'entry_period', '2030-01',
      'career', (SELECT code FROM careers WHERE id = career))
  )));
  IF v LIKE 'ERR:%' THEN RAISE EXCEPTION 'IMPORT_FAILED[%]', v; END IF;
  j := v::jsonb;
  IF (j->'counts'->>'new')::int <> 2 OR (j->'counts'->>'error')::int <> 0 THEN RAISE EXCEPTION 'IMPORT_COUNTS[%]', j->'counts'; END IF;
  SELECT id INTO pid2 FROM participants WHERE email = 'pa.imp@test.invalid';
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = pid2 AND full_name = 'Beto Ruiz Díaz' AND high_school_grade = 'graduado' AND entry_period = '2028-01'
      AND origin = 'forms' AND forms_consent IS NULL AND (to_jsonb(participants)->>'birth_date') IS NULL AND initial_career_id = career) THEN RAISE EXCEPTION 'IMPORT_FIELDS'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE email = 'pa.imp2@test.invalid' AND (high_school_grade IS NOT NULL OR entry_period IS NOT NULL))
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') x WHERE x->>'email' = 'pa.imp2@test.invalid' AND x->>'warnings' LIKE '%Grado de preparatoria no reconocido%' AND x->>'warnings' LIKE '%Periodo de ingreso no reconocido%') THEN RAISE EXCEPTION 'IMPORT_UNKNOWN_VALUES'; END IF;
  v_n := v_n + 4;
  -- un archivo que trae consentimiento negativo se rechaza; uno sin esa columna no
  j := pg_temp.run(c, $q$select preview_participant_import('[{"row":2,"email":"pa.nc@test.invalid","full_name":"Sin Consentimiento","consent":false}]'::jsonb)$q$)::jsonb;
  IF (j->'counts'->>'error')::int <> 1 THEN RAISE EXCEPTION 'IMPORT_NEGATIVE_CONSENT_ACCEPTED'; END IF;
  j := pg_temp.run(c, $q$select preview_participant_import('[{"row":2,"email":"pa.nc2@test.invalid","full_name":"Con Consentimiento","consent":true}]'::jsonb)$q$)::jsonb;
  IF (j->'counts'->>'new')::int <> 1 THEN RAISE EXCEPTION 'IMPORT_POSITIVE_CONSENT'; END IF;
  v_n := v_n + 2;
  -- self-service ya existente + archivo oficial con el mismo correo: se concilia, no se duplica, no toca cuenta
  UPDATE participants SET password_configured_at = now(), auth_user_id = u5::uuid WHERE id = pid;
  j := pg_temp.j(pg_temp.run(c, format($q$select commit_participant_import(%L::jsonb, 'forms2.csv', false)$q$, jsonb_build_array(
    jsonb_build_object('row', 2, 'email', 'ana.self@test.invalid', 'full_name', 'Ana María López Pérez', 'phone', '9981234567', 'high_school', 'Otra escuela',
      'high_school_grade', '3', 'entry_period', '2027-08', 'career', (SELECT code FROM careers WHERE id = career))))));
  IF (SELECT count(*) FROM participants WHERE edition_id = ed AND email = 'ana.self@test.invalid') <> 1 OR (j->'counts'->>'new')::int <> 0 THEN RAISE EXCEPTION 'IMPORT_DUPLICATED_SELF_SERVICE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = pid AND auth_user_id = u5::uuid AND password_configured_at IS NOT NULL AND origin = 'self_service') THEN RAISE EXCEPTION 'IMPORT_TOUCHED_ACCOUNT'; END IF;
  j := pg_temp.j(pg_temp.run(c, format($q$select commit_participant_import(%L::jsonb, 'forms3.csv', false)$q$, jsonb_build_array(
    jsonb_build_object('row', 2, 'email', 'ana.self@test.invalid', 'full_name', 'Ana María López Pérez', 'high_school_grade', 'graduado', 'entry_period', '2028-08',
      'career', (SELECT code FROM careers WHERE id = career))))));
  IF (SELECT high_school_grade FROM participants WHERE id = pid) <> 'graduado' OR (SELECT auth_user_id FROM participants WHERE id = pid) <> u5::uuid THEN RAISE EXCEPTION 'IMPORT_RECONCILE'; END IF;
  v_n := v_n + 3;

  -- ===== 7. Edición administrativa: campos nuevos, reglas de correcciones manuales =====
  IF pg_temp.run(s, format($q$select update_participant(%L, '{"high_school_grade":"1","entry_period":"2027-01","birth_date":"2008-01-01"}'::jsonb)$q$, pid2)) <> 'ok' THEN RAISE EXCEPTION 'UPDATE_FAILED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM participants WHERE id = pid2 AND high_school_grade = '1' AND entry_period = '2027-01' AND (to_jsonb(participants)->>'birth_date') IS NULL
      AND manual_overrides ?& ARRAY['high_school_grade', 'entry_period']) THEN RAISE EXCEPTION 'UPDATE_FIELDS'; END IF;
  IF pg_temp.run(s, format($q$select update_participant(%L, '{"high_school_grade":"7"}'::jsonb)$q$, pid2)) <> 'ERR:INVALID_GRADE'
     OR pg_temp.run(s, format($q$select update_participant(%L, '{"entry_period":"2031-05"}'::jsonb)$q$, pid2)) <> 'ERR:INVALID_PERIOD' THEN RAISE EXCEPTION 'UPDATE_VALIDATION'; END IF;
  IF pg_temp.run(u5, format($q$select update_participant(%L, '{"high_school_grade":"2"}'::jsonb)$q$, pid2)) NOT LIKE 'ERR:%NOT_AUTHORIZED%'
     OR pg_temp.run(r, format($q$select update_participant(%L, '{"high_school_grade":"2"}'::jsonb)$q$, pid2)) NOT LIKE 'ERR:%NOT_AUTHORIZED%' THEN RAISE EXCEPTION 'UPDATE_ROLES'; END IF;
  -- la corrección manual protege contra una importación posterior y deja un registro por revisar
  j := pg_temp.j(pg_temp.run(c, format($q$select commit_participant_import(%L::jsonb, 'forms4.csv', false)$q$, jsonb_build_array(
    jsonb_build_object('row', 2, 'email', 'pa.imp@test.invalid', 'full_name', 'Beto Ruiz Díaz', 'high_school_grade', '3', 'career', (SELECT code FROM careers WHERE id = career))))));
  IF (SELECT high_school_grade FROM participants WHERE id = pid2) <> '1' OR (j->'counts'->>'conflict')::int <> 1 THEN RAISE EXCEPTION 'MANUAL_CORRECTION_OVERWRITTEN'; END IF;
  j := pg_temp.run(c, 'select list_import_conflicts()')::jsonb;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j) x WHERE x->>'participant_id' = pid2::text AND x->>'field' = 'high_school_grade' AND x->>'imported_value' = '3' AND x->>'current_value' = '1') THEN RAISE EXCEPTION 'CONFLICT_NOT_LISTED'; END IF;
  PERFORM pg_temp.run(c, format($q$select resolve_import_conflict(%L, true)$q$, (SELECT x->>'id' FROM jsonb_array_elements(j) x WHERE x->>'field' = 'high_school_grade' LIMIT 1)::uuid));
  IF (SELECT high_school_grade FROM participants WHERE id = pid2) <> '3' THEN RAISE EXCEPTION 'CONFLICT_ACCEPT'; END IF;
  v_n := v_n + 6;
  -- un archivo sin segunda carrera no borra la existente
  PERFORM pg_temp.run(s, format($q$select update_participant(%L, jsonb_build_object('initial_career_id_2', %L))$q$, pid2, career2));
  IF NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pid2 AND preference = 2 AND career_id = career2) THEN RAISE EXCEPTION 'SECOND_CAREER_NOT_SET'; END IF;
  PERFORM pg_temp.run(c, format($q$select commit_participant_import(%L::jsonb, 'forms5.csv', false)$q$, jsonb_build_array(
    jsonb_build_object('row', 2, 'email', 'pa.imp@test.invalid', 'full_name', 'Beto Ruiz Díaz', 'career', (SELECT code FROM careers WHERE id = career), 'phone', '9985557777'))));
  IF NOT EXISTS (SELECT 1 FROM initial_interests WHERE participant_id = pid2 AND preference = 2 AND career_id = career2) THEN RAISE EXCEPTION 'IMPORT_ERASED_SECOND_CAREER'; END IF;
  v_n := v_n + 2;

  -- ===== 8. Lectura administrativa, PII y roles =====
  j := pg_temp.run(s, format($q$select get_participant(%L)$q$, pid2))::jsonb;
  IF j ? 'birth_date' OR NOT (j ?& ARRAY['high_school_grade', 'entry_period', 'access_configured', 'has_logged_in', 'platform_consent_at']) OR (j->>'high_school_grade') <> '3' THEN RAISE EXCEPTION 'GET_PARTICIPANT_SHAPE[%]', j; END IF;
  IF (pg_temp.run(s, format($q$select get_participant(%L)$q$, pid))::jsonb->>'access_configured') <> 'true' OR (j->>'access_configured') <> 'false' THEN RAISE EXCEPTION 'ACCESS_STATUS'; END IF;
  IF (pg_temp.run(s, format($q$select get_participant(%L)$q$, pid))::jsonb->>'platform_consent_source') IS NULL THEN RAISE EXCEPTION 'CONSENT_SOURCE_HIDDEN'; END IF;
  IF pg_temp.run(u5, format($q$select get_participant(%L)$q$, pid2)) NOT LIKE 'ERR:%NOT_AUTHORIZED%' OR pg_temp.run(r, format($q$select get_participant(%L)$q$, pid2)) NOT LIKE 'ERR:%NOT_AUTHORIZED%'
     OR pg_temp.run(u5, $q$select search_participants('pa.')$q$) NOT LIKE 'ERR:%NOT_AUTHORIZED%' THEN RAISE EXCEPTION 'PII_ROLES'; END IF;
  IF pg_temp.run('anon', 'select count(*) from participants') NOT LIKE 'ERR:%permission denied%' OR pg_temp.run(u5, 'select count(*) from participants') NOT LIKE 'ERR:%permission denied%' THEN RAISE EXCEPTION 'PARTICIPANTS_READABLE'; END IF;
  IF pg_temp.run(s, format($q$select update_participant(%L, '{"full_name":"Beto Editado Ruiz"}'::jsonb)$q$, pid2)) <> 'ok' THEN RAISE EXCEPTION 'STAFF_EDIT'; END IF;
  j := pg_temp.run(s, $q$select search_participants('pa.imp')$q$)::jsonb;
  IF jsonb_array_length(j) < 1 OR NOT (j->0 ? 'access_configured') THEN RAISE EXCEPTION 'SEARCH_SHAPE'; END IF;
  v_n := v_n + 7;
  -- exportación: grado y periodo estructurales, sin fecha de nacimiento
  j := pg_temp.run(c, $q$select export_participants('prueba regresion acceso', false)$q$)::jsonb;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') x WHERE x->>'email' = 'ana.self@test.invalid' AND x->>'high_school_grade' = 'graduado' AND x->>'entry_period' = '2028-08' AND x->>'origin' = 'self_service')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') x WHERE x ? 'birth_date') THEN RAISE EXCEPTION 'EXPORT_SHAPE'; END IF;
  IF pg_temp.run(s, $q$select export_participants('prueba regresion acceso', false)$q$) NOT LIKE 'ERR:%NOT_AUTHORIZED%' THEN RAISE EXCEPTION 'EXPORT_STAFF'; END IF;
  v_n := v_n + 2;
  -- compatibilidad con el frontend anterior (solo mientras el contrato no se haya aplicado)
  IF NOT retired THEN
    j := pg_temp.run(c, 'select coordination_summary()')::jsonb;
    IF (j->>'missing_birth_date') <> '0' THEN RAISE EXCEPTION 'COMPAT_SUMMARY'; END IF;
    IF NOT (pg_temp.run(s, format($q$select get_participant(%L)$q$, pid2))::jsonb ? 'access') THEN RAISE EXCEPTION 'COMPAT_ACCESS_KEY'; END IF;
    IF (pg_temp.run(s, $q$select search_participants('pa.imp')$q$)::jsonb->0->>'has_birth_date') <> 'true' THEN RAISE EXCEPTION 'COMPAT_SEARCH'; END IF;
    IF pg_temp.run(s, format($q$select create_participant_manual(jsonb_build_object('email','pa.manual@test.invalid','full_name','Manual Prueba','phone','9985550000','high_school','Prepa','initial_career_id',%L,'consent_confirmed',true))$q$, career)) LIKE 'ERR:%' THEN RAISE EXCEPTION 'COMPAT_MANUAL_CREATE'; END IF;
    v_n := v_n + 4;
  ELSE
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'participants' AND column_name = 'birth_date') THEN RAISE EXCEPTION 'BIRTH_DATE_STILL_EXISTS'; END IF;
    IF to_regprocedure('public.create_participant_manual(jsonb)') IS NOT NULL OR to_regprocedure('public.clear_access_lock(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'LEGACY_STILL_EXISTS'; END IF;
    v_n := v_n + 2;
  END IF;

  -- ===== 9. Restablecer contraseña: auditoría sin la contraseña =====
  IF pg_temp.run('service', format($q$select participant_password_audit_internal(%L, %L)$q$, s, pid2)) <> 'ok' OR pg_temp.run('service', format($q$select participant_password_audit_internal(%L, %L)$q$, c, pid2)) <> 'ok' THEN RAISE EXCEPTION 'PASSWORD_AUDIT_FAILED'; END IF;
  IF pg_temp.run('service', format($q$select participant_password_audit_internal(%L, %L)$q$, r, pid2)) <> 'ERR:NOT_AUTHORIZED'
     OR pg_temp.run('service', format($q$select participant_password_audit_internal(%L, %L)$q$, gen_random_uuid(), pid2)) <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'PASSWORD_AUDIT_ROLES'; END IF;
  IF (SELECT count(*) FROM audit_log WHERE action = 'participant.password_reset' AND detail = jsonb_build_object('participant_id', pid2)) <> 2 THEN RAISE EXCEPTION 'PASSWORD_AUDIT_DETAIL'; END IF;
  IF EXISTS (SELECT 1 FROM audit_log WHERE action LIKE 'participant.%' AND detail::text ~* '(password|contrase)') THEN RAISE EXCEPTION 'PASSWORD_IN_AUDIT'; END IF;
  v_n := v_n + 4;

  -- ===== 10. Preparation Reset: identidades por la relación real (sin ejecutar el reset) =====
  INSERT INTO participants (edition_id, email, full_name, origin, auth_user_id) VALUES (ed, 'pa.syn@test.invalid', 'Sintético', 'forms', u2::uuid) RETURNING id INTO p_syn;
  -- el patrón sintético usa el id del participante: se ajusta el usuario de prueba a ese id
  UPDATE auth.users SET email = 'p.' || p_syn::text || '@participantes.diaov.invalid', raw_app_meta_data = '{}' WHERE id = u2::uuid;
  INSERT INTO participants (edition_id, email, full_name, origin, auth_user_id) VALUES (ed, 'pa.staffident@test.invalid', 'Con identidad de Staff', 'forms', u3::uuid) RETURNING id INTO p_staff;
  INSERT INTO participants (edition_id, email, full_name, origin, auth_user_id) VALUES (ed, 'pa.nokind@test.invalid', 'Sin marca', 'forms', u4::uuid) RETURNING id INTO p_other;
  IF NOT EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id = u1::uuid)
     OR NOT EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id = u5::uuid) THEN RAISE EXCEPTION 'RESET_MISSES_REAL_EMAIL_IDENTITIES'; END IF;
  IF NOT EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id = u2::uuid) THEN RAISE EXCEPTION 'RESET_MISSES_SYNTHETIC_IDENTITIES'; END IF;
  IF EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id IN (c::uuid, s::uuid, r::uuid, u3::uuid)) THEN RAISE EXCEPTION 'RESET_SELECTS_STAFF'; END IF;
  IF EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id = u4::uuid) THEN RAISE EXCEPTION 'RESET_SELECTS_UNMARKED_IDENTITY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM preparation_participant_auth_ids(ed) WHERE auth_user_id = u1::uuid) THEN RAISE EXCEPTION 'HELPER_UNSTABLE'; END IF;
  v := pg_temp.run(c, format($q$select preparation_reset_preview_internal(%L)::jsonb->'counts'->>'auth_identities'$q$, c));
  IF v LIKE 'ERR:%' THEN
    v := pg_temp.run('service', format($q$select preparation_reset_preview_internal(%L)::jsonb->'counts'->>'auth_identities'$q$, c));
  END IF;
  IF v::int <> (SELECT count(*) FROM preparation_participant_auth_ids(ed)) OR v::int < 3 THEN RAISE EXCEPTION 'PREVIEW_IDENTITY_COUNT[%]', v; END IF;
  IF has_function_privilege('anon', 'public.reset_preparation_internal(uuid,text)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.reset_preparation_internal(uuid,text)', 'EXECUTE') THEN RAISE EXCEPTION 'RESET_GRANTS'; END IF;
  v_n := v_n + 7;

  RAISE EXCEPTION 'PARTICIPANT_ACCESS_OK % checks (retired=%)', v_n, retired;
END
$test$;
