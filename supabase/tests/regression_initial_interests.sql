-- Pruebas de regresión Fase 8A — Intereses iniciales del prerregistro (hasta 2 carreras).
-- Se ejecuta como un solo bloque DO. Siempre termina con RAISE EXCEPTION que trae los resultados,
-- así que todos los cambios se revierten. Cubre: modelo, alta manual, corrección, importación,
-- recomendaciones y seguridad. Pega el archivo completo en el SQL editor.

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  s uuid := '00000000-0000-4000-8000-0000000000c2';
  r uuid := '00000000-0000-4000-8000-0000000000c3';
  ua uuid := '00000000-0000-4000-8000-0000000000d1';
  ub uuid := '00000000-0000-4000-8000-0000000000d2';
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_pid uuid; v_pid2 uuid;
  st record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean;
  v_res text := ''; v_pass int := 0; v_fail int := 0;
  v_def text;
BEGIN
  -- ====== FIXTURE ======
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt8a.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, ua, ub]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RT8A Coord', true, 'rt8a.c1@test.invalid'),
    (s, 'staff', 'RT8A Staff', true, 'rt8a.c2@test.invalid'),
    (r, 'sorteo', 'RT8A Sorteo', true, 'rt8a.c3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');

  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES
    ('RT8A-C1', 'RT8A Carrera 1', v_div, true, true),
    ('RT8A-C2', 'RT8A Carrera 2', v_div, true, true),
    ('RT8A-C3', 'RT8A Carrera 3', v_div, true, true);
  SELECT id INTO v_c1 FROM careers WHERE code = 'RT8A-C1';
  SELECT id INTO v_c2 FROM careers WHERE code = 'RT8A-C2';
  SELECT id INTO v_c3 FROM careers WHERE code = 'RT8A-C3';

  -- Participant A: C1+C2, with platform consent
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, initial_career_id, auth_user_id)
  VALUES (ed, 'rt8a.a@test.invalid', 'Ana Test OchoA', '2008-01-01', 'demo', true, v_c1, ua);
  SELECT id INTO v_pid FROM participants WHERE email = 'rt8a.a@test.invalid';
  PERFORM sync_initial_interests(v_pid, ARRAY[v_c1, v_c2], ARRAY['Gastronomia', 'Negocios']);
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid;

  -- Participant B: C2 only, with platform consent
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, initial_career_id, auth_user_id)
  VALUES (ed, 'rt8a.b@test.invalid', 'Beto Test OchoB', '2008-02-02', 'demo', true, v_c2, ub);
  SELECT id INTO v_pid2 FROM participants WHERE email = 'rt8a.b@test.invalid';
  PERFORM sync_initial_interests(v_pid2, ARRAY[v_c2], ARRAY['Negocios']);
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid2;

  -- Activities: W1->C1, W2->C1+C2, W3->C2
  DECLARE v_act uuid; v_sid uuid;
  BEGIN
    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'RT8A W1 Crepas', '', 'Edificio', true) RETURNING id INTO v_act;
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
    VALUES (v_act, now() + interval '2 hours', now() + interval '3 hours', 30, 'Edificio', 'activa', true, 1) RETURNING id INTO v_sid;
    INSERT INTO activity_careers (activity_id, career_id) VALUES (v_act, v_c1);

    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'RT8A W2 Restaurante', '', 'Edificio', true) RETURNING id INTO v_act;
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
    VALUES (v_act, now() + interval '4 hours', now() + interval '5 hours', 30, 'Edificio', 'activa', true, 1) RETURNING id INTO v_sid;
    INSERT INTO activity_careers (activity_id, career_id) VALUES (v_act, v_c1);
    INSERT INTO activity_careers (activity_id, career_id) VALUES (v_act, v_c2);

    INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
    VALUES (ed, v_div, 'RT8A W3 Finanzas', '', 'Edificio', true) RETURNING id INTO v_act;
    INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
    VALUES (v_act, now() + interval '6 hours', now() + interval '7 hours', 30, 'Edificio', 'activa', true, 1) RETURNING id INTO v_sid;
    INSERT INTO activity_careers (activity_id, career_id) VALUES (v_act, v_c2);
  END;

  SELECT pg_get_functiondef('public.my_recommended_activities()'::regprocedure) INTO v_def;

  -- ====== TEST STEPS ======
  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  -- ===== Modelo / migración =====
  ('modelo: tabla existe', 'P', 'select count(*) > 0 from information_schema.tables where table_name = ''initial_interests''', 'TRUE'),
  ('modelo: A tiene 2 intereses', 'P', 'select count(*) = 2 from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid', 'TRUE'),
  ('modelo: B tiene 1 interes', 'P', 'select count(*) = 1 from initial_interests where participant_id = ' || quote_literal(v_pid2) || '::uuid', 'TRUE'),
  ('modelo: orden 1 ok', 'P', 'select preference = 1 and career_id = ' || quote_literal(v_c1) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 1', 'TRUE'),
  ('modelo: orden 2 ok', 'P', 'select preference = 2 and career_id = ' || quote_literal(v_c2) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 2', 'TRUE'),
  ('modelo: raw 1 alineado', 'P', 'select career_raw = ''Gastronomia'' from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 1', 'TRUE'),
  ('modelo: raw 2 alineado', 'P', 'select career_raw = ''Negocios'' from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 2', 'TRUE'),
  ('modelo: sin duplicados', 'P', 'select count(*) = 0 from (select participant_id, career_id from initial_interests group by participant_id, career_id having count(*) > 1) x', 'TRUE'),
  ('modelo: max 2 CHECK', 'P', 'insert into initial_interests (participant_id, preference, career_id) values (' || quote_literal(v_pid) || '::uuid, 3, ' || quote_literal(v_c3) || '::uuid)', 'ERR:check constraint'),
  ('modelo: UNIQUE', 'P', 'insert into initial_interests (participant_id, preference, career_id) values (' || quote_literal(v_pid2) || '::uuid, 2, ' || quote_literal(v_c2) || '::uuid)', 'ERR:unique'),
  ('modelo: sync initial_career_id', 'P', 'select initial_career_id = ' || quote_literal(v_c1) || '::uuid from participants where id = ' || quote_literal(v_pid) || '::uuid', 'TRUE'),

  -- ===== Recomendaciones (antes de correcciones que cambian intereses) =====
  ('recom: A obtiene talleres', 'A', 'select jsonb_array_length(my_recommended_activities()->''recommendations'') > 0', 'TRUE'),
  ('recom: A ve W3 Finanzas (C2)', 'A', 'select exists (select 1 from jsonb_array_elements(my_recommended_activities()->''recommendations'') x where x->>''title'' = ''RT8A W3 Finanzas'')', 'TRUE'),
  ('recom: A ve W1 Crepas (C1)', 'A', 'select exists (select 1 from jsonb_array_elements(my_recommended_activities()->''recommendations'') x where x->>''title'' = ''RT8A W1 Crepas'')', 'TRUE'),
  ('recom: W2 una vez (dedup)', 'A', 'select count(*) = 1 from jsonb_array_elements(my_recommended_activities()->''recommendations'') x where x->>''title'' = ''RT8A W2 Restaurante''', 'TRUE'),
  ('recom: 3 talleres distintos', 'A', 'select jsonb_array_length(my_recommended_activities()->''recommendations'') = 3', 'TRUE'),
  ('recom: post_event no en def', 'P', 'select position(''post_event_interests'' in ' || quote_literal(v_def) || ') = 0', 'TRUE'),
  ('recom: initial_interests en def', 'P', 'select position(''initial_interests'' in ' || quote_literal(v_def) || ') > 0', 'TRUE'),

  -- ===== Alta manual: validaciones =====
  ('alta: falta birth_date', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m1@t.invalid'',''full_name'',''Manual Uno'',''phone'',''9981111111'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'ERR:BIRTH_DATE_REQUIRED'),
  ('alta: falta telefono', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m2@t.invalid'',''full_name'',''Manual Dos'',''birth_date'',''2008-03-03'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'ERR:PHONE_REQUIRED'),
  ('alta: falta preparatoria', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m3@t.invalid'',''full_name'',''Manual Tres'',''birth_date'',''2008-03-03'',''phone'',''9982222222'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'ERR:HIGH_SCHOOL_REQUIRED'),
  ('alta: falta carrera', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m4@t.invalid'',''full_name'',''Manual Cuatro'',''birth_date'',''2008-03-03'',''phone'',''9983333333'',''high_school'',''Prepa'',''consent_confirmed'',true,''is_demo'',true))', 'ERR:CAREER_REQUIRED'),
  ('alta: sin consentimiento', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m5@t.invalid'',''full_name'',''Manual Cinco'',''birth_date'',''2008-03-03'',''phone'',''9984444444'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',false,''is_demo'',true))', 'ERR:CONSENT_REQUIRED'),
  ('alta: carrera inexistente', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m5b@t.invalid'',''full_name'',''Manual CincoB'',''birth_date'',''2008-03-03'',''phone'',''9984444445'',''high_school'',''Prepa'',''initial_career_id'',''00000000-0000-0000-0000-000000000099'',''consent_confirmed'',true,''is_demo'',true))', 'ERR:INVALID_CAREER'),
  ('alta: una carrera ok', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m6@t.invalid'',''full_name'',''Manual Seis'',''birth_date'',''2008-03-03'',''phone'',''9985555555'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'OK'),
  ('alta: una carrera 1 interes', 'P', 'select count(*) = 1 from initial_interests ii join participants p on p.id = ii.participant_id where p.email = ''rt8a.m6@t.invalid''', 'TRUE'),
  ('alta: dos carreras ok', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m7@t.invalid'',''full_name'',''Manual Siete'',''birth_date'',''2008-04-04'',''phone'',''9986666666'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''initial_career_id_2'',''' || v_c2::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'OK'),
  ('alta: dos carreras 2 intereses', 'P', 'select count(*) = 2 from initial_interests ii join participants p on p.id = ii.participant_id where p.email = ''rt8a.m7@t.invalid''', 'TRUE'),
  ('alta: dos carreras orden', 'P', 'select ii.preference = 1 and ii.career_id = ' || quote_literal(v_c1) || '::uuid from initial_interests ii join participants p on p.id = ii.participant_id where p.email = ''rt8a.m7@t.invalid'' and ii.preference = 1', 'TRUE'),
  ('alta: carrera duplicada', 'S', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.m8@t.invalid'',''full_name'',''Manual Ocho'',''birth_date'',''2008-04-04'',''phone'',''9987777777'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''initial_career_id_2'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'ERR:DUPLICATE'),

  -- ===== Corrección =====
  ('correccion: cambiar carrera 1', 'S', 'select update_participant(' || quote_literal(v_pid) || '::uuid, jsonb_build_object(''initial_career_id'',''' || v_c3::text || '''))', 'OK'),
  ('correccion: carrera 1 ok', 'P', 'select career_id = ' || quote_literal(v_c3) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 1', 'TRUE'),
  ('correccion: initial_career_id sync', 'P', 'select initial_career_id = ' || quote_literal(v_c3) || '::uuid from participants where id = ' || quote_literal(v_pid) || '::uuid', 'TRUE'),
  ('correccion: carrera 2 intacta', 'P', 'select career_id = ' || quote_literal(v_c2) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 2', 'TRUE'),
  ('correccion: cambiar carrera 2 a C1', 'S', 'select update_participant(' || quote_literal(v_pid) || '::uuid, jsonb_build_object(''initial_career_id_2'',''' || v_c1::text || '''))', 'OK'),
  ('correccion: carrera 2 ok', 'P', 'select career_id = ' || quote_literal(v_c1) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 2', 'TRUE'),
  ('correccion: limpiar carrera 2', 'S', 'select update_participant(' || quote_literal(v_pid) || '::uuid, jsonb_build_object(''initial_career_id_2'',''''))', 'OK'),
  ('correccion: carrera 2 limpiada', 'P', 'select count(*) = 0 from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 2', 'TRUE'),
  ('correccion: carrera 1 intacta tras limpiar 2', 'P', 'select count(*) = 1 from initial_interests where participant_id = ' || quote_literal(v_pid) || '::uuid and preference = 1', 'TRUE'),
  ('correccion: promocion 2 a 1', 'S', 'select update_participant(' || quote_literal(v_pid2) || '::uuid, jsonb_build_object(''initial_career_id'','''',''initial_career_id_2'',''' || v_c1::text || '''))', 'OK'),
  ('correccion: carrera 2 promovida', 'P', 'select career_id = ' || quote_literal(v_c1) || '::uuid from initial_interests where participant_id = ' || quote_literal(v_pid2) || '::uuid and preference = 1', 'TRUE'),
  ('correccion: no preference 2 tras promocion', 'P', 'select count(*) = 0 from initial_interests where participant_id = ' || quote_literal(v_pid2) || '::uuid and preference = 2', 'TRUE'),

  -- ===== Corrección: cambio de correo con historial =====
  ('correccion: cambiar correo', 'S', 'select update_participant(' || quote_literal(v_pid) || '::uuid, jsonb_build_object(''email'',''rt8a.a.new@t.invalid'',''email_reason'',''correccion''))', 'OK'),
  ('correccion: historial', 'P', 'select count(*) = 1 from participant_email_history where participant_id = ' || quote_literal(v_pid) || '::uuid and email = ''rt8a.a@test.invalid''', 'TRUE'),
  ('correccion: motivo', 'P', 'select reason = ''correccion'' from participant_email_history where participant_id = ' || quote_literal(v_pid) || '::uuid and email = ''rt8a.a@test.invalid''', 'TRUE'),
  ('correccion: correo vigente', 'P', 'select email = ''rt8a.a.new@t.invalid'' from participants where id = ' || quote_literal(v_pid) || '::uuid', 'TRUE'),

  -- ===== Seguridad =====
  ('seg: A no lee B', 'A', 'select count(*) from initial_interests where participant_id = ' || quote_literal(v_pid2) || '::uuid', 'ERR:permission denied'),
  ('seg: A lee propias via RPC', 'A', 'select jsonb_array_length(get_my_initial_interests()) >= 1', 'TRUE'),
  ('seg: anon no lee', 'X', 'select count(*) from initial_interests', 'ERR:permission denied'),
  ('seg: anon no sync', 'X', 'select sync_initial_interests(' || quote_literal(v_pid) || '::uuid, array[''' || v_c1::text || ''']::uuid[], null)', 'ERR:permission denied'),
  ('seg: sorteo no sync', 'R', 'select sync_initial_interests(' || quote_literal(v_pid) || '::uuid, array[''' || v_c1::text || ''']::uuid[], null)', 'ERR:permission denied'),
  ('seg: sorteo no crea', 'R', 'select create_participant_manual(jsonb_build_object(''email'',''rt8a.sorteo@t.invalid'',''full_name'',''Sorteo Test'',''birth_date'',''2008-01-01'',''phone'',''9989999999'',''high_school'',''Prepa'',''initial_career_id'',''' || v_c1::text || ''',''consent_confirmed'',true,''is_demo'',true))', 'ERR:NOT_AUTHORIZED'),
  ('seg: get_my_initial_interests own', 'A', 'select jsonb_array_length(get_my_initial_interests()) >= 1', 'TRUE'),
  ('seg: B no update A', 'B', 'select update_participant(' || quote_literal(v_pid) || '::uuid, jsonb_build_object(''full_name'',''Hackeado''))', 'ERR:NOT_AUTHORIZED');

  -- ===== RUN STEPS =====
  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_q := st.q;
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'A' THEN ua WHEN 'B' THEN ub END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF st.who = 'X' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
      ELSIF v_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
      END IF;
      IF v_q ~* '^(update|insert|create)' THEN EXECUTE v_q; ELSE EXECUTE v_q INTO v_val; END IF;
    EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    v_ok := CASE
      WHEN st.expect = 'OK' THEN v_err IS NULL
      WHEN st.expect = 'TRUE' THEN v_err IS NULL AND v_val = 'true'
      WHEN st.expect LIKE 'ERR:%' THEN v_err LIKE '%' || substr(st.expect, 5) || '%'
    END;
    IF v_ok THEN v_pass := v_pass + 1;
    ELSE v_fail := v_fail + 1; v_res := v_res || st.name || '[' || coalesce('err:' || v_err, 'val:' || coalesce(v_val, 'null')) || '] '; END IF;
  END LOOP;
  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, v_res;
END
$test$;
