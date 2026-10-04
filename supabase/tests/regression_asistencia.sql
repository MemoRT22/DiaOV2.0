-- Pruebas de regresión de asistencia / check-in (QR y código manual).
-- Se ejecuta como un solo bloque DO. Siempre termina con RAISE EXCEPTION que trae los resultados,
-- así que todos los cambios se revierten. Cubre: autorización, credenciales, reservación,
-- ventana de tiempo, estado de sesión, idempotencia, créditos/snapshot y seguridad de datos.
-- Pega el archivo completo en el SQL editor.

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  s uuid := '00000000-0000-4000-8000-0000000000c2';
  r uuid := '00000000-0000-4000-8000-0000000000c3';
  ua uuid := '00000000-0000-4000-8000-0000000000d1';
  ub uuid := '00000000-0000-4000-8000-0000000000d2';
  un uuid := '00000000-0000-4000-8000-0000000000d3';
  ed uuid := active_edition_id();
  t0 timestamptz := date_trunc('hour', now()) + interval '2 days';
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_act uuid; v_career uuid;
  v_c1 uuid; v_c2 uuid; v_cn uuid; v_co uuid; v_cf uuid;
  v_pa uuid; v_pb uuid;
  v_c1_token text; v_c1_code text; v_c2_token text;
  v_cn_token text; v_co_token text; v_cf_token text;
  st record; k record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean;
  v_res text := ''; v_pass int := 0; v_fail int := 0;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rtr.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, ua, ub, un]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RTR Coord', true, 'rtr.c1@test.invalid'),
    (s, 'staff', 'RTR Staff', true, 'rtr.c2@test.invalid'),
    (r, 'sorteo', 'RTR Sorteo', true, 'rtr.c3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RTR-REAL2', 'RTR Carrera 2', v_div, false, true)
  RETURNING id INTO v_career;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, auth_user_id, initial_career_id) VALUES
    (ed, 'rtr.a@test.invalid', 'Ana Ruta', '2008-01-01', 'forms', ua, v_career),
    (ed, 'rtr.b@test.invalid', 'Beto Ruta', '2008-01-02', 'forms', ub, v_career),
    (ed, 'rtr.n@test.invalid', 'Nora SinAviso', '2008-01-03', 'forms', un, v_career);
  SELECT id INTO v_pa FROM participants WHERE email = 'rtr.a@test.invalid';
  SELECT id INTO v_pb FROM participants WHERE email = 'rtr.b@test.invalid';
  UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM participants p JOIN editions e ON e.id = p.edition_id
  WHERE pp.participant_id = p.id AND p.email IN ('rtr.a@test.invalid', 'rtr.b@test.invalid');
  UPDATE editions SET reservations_open_at = now() - interval '1 hour', reservations_close_at = NULL,
    max_reservations = 4, travel_buffer_minutes = 10,
    checkin_open_before_minutes = 5, checkin_close_after_minutes = 20 WHERE id = ed;

  FOR k IN SELECT * FROM (VALUES
    ('C1','WQ1',0,20,30,1), ('C2','WQ2',60,100,30,2), ('CN','WQ3',200,220,30,1),
    ('CO','WQ4',300,320,30,1), ('CF','WQ5',6000,6020,30,1)
  ) AS x(sk, wk, a, b, cap, cr) LOOP
    SELECT id INTO v_act FROM activities WHERE edition_id = ed AND title = 'RTR ' || k.wk;
    IF v_act IS NULL THEN
      INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
      VALUES (ed, v_div, 'RTR ' || k.wk, '', 'Edificio RTR', false) RETURNING id INTO v_act;
    END IF;
    IF k.sk = 'C1' THEN
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0, t0 + interval '20 minutes', k.cap, 'Edificio RTR', 'activa', false, k.cr) RETURNING id INTO v_c1;
    ELSIF k.sk = 'C2' THEN
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0 + interval '60 minutes', t0 + interval '100 minutes', k.cap, 'Edificio RTR', 'activa', false, k.cr) RETURNING id INTO v_c2;
    ELSIF k.sk = 'CN' THEN
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0 + interval '200 minutes', t0 + interval '220 minutes', k.cap, 'Edificio RTR', 'cancelada', false, k.cr) RETURNING id INTO v_cn;
    ELSIF k.sk = 'CO' THEN
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0 + interval '300 minutes', t0 + interval '320 minutes', k.cap, 'Edificio RTR', 'oculta', false, k.cr) RETURNING id INTO v_co;
    ELSIF k.sk = 'CF' THEN
      INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
      VALUES (v_act, t0 + interval '6000 minutes', t0 + interval '6020 minutes', k.cap, 'Edificio RTR', 'activa', false, k.cr) RETURNING id INTO v_cf;
    END IF;
  END LOOP;

  UPDATE activity_sessions SET ends_at = now() - interval '2 minutes', starts_at = now() - interval '22 minutes' WHERE id = v_c1;
  UPDATE activity_sessions SET ends_at = now() - interval '2 minutes', starts_at = now() - interval '42 minutes' WHERE id = v_c2;
  UPDATE activity_sessions SET ends_at = now() - interval '2 minutes', starts_at = now() - interval '22 minutes' WHERE id = v_cn;
  UPDATE activity_sessions SET ends_at = now() - interval '2 minutes', starts_at = now() - interval '22 minutes' WHERE id = v_co;

  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pa, id, activity_id FROM activity_sessions WHERE id IN (v_c1, v_c2);
  INSERT INTO reservations (participant_id, session_id, activity_id)
  SELECT v_pb, id, activity_id FROM activity_sessions WHERE id = v_c1;

  SELECT extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key()),
         extensions.pgp_sym_decrypt(sc.manual_code_encrypted, credential_encryption_key())
  INTO v_c1_token, v_c1_code FROM session_credentials sc WHERE sc.session_id = v_c1;
  SELECT extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key())
  INTO v_c2_token FROM session_credentials sc WHERE sc.session_id = v_c2;
  SELECT extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key())
  INTO v_cn_token FROM session_credentials sc WHERE sc.session_id = v_cn;
  SELECT extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key())
  INTO v_co_token FROM session_credentials sc WHERE sc.session_id = v_co;
  SELECT extensions.pgp_sym_decrypt(sc.qr_token_encrypted, credential_encryption_key())
  INTO v_cf_token FROM session_credentials sc WHERE sc.session_id = v_cf;

  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  ('auth anon', 'X', 'select check_in(''x'')', 'ERR:permission denied'),
  ('auth sinAviso', 'N', 'select check_in(''x'')', 'ERR:PRIVACY_NOTICE_REQUIRED'),
  ('auth staff', 'S', 'select check_in(''x'')', 'ERR:NOT_AUTHORIZED'),
  ('auth sorteo', 'R', 'select check_in(''x'')', 'ERR:NOT_AUTHORIZED'),
  ('estudiante no credenciales', 'A', 'select session_credential_display(' || quote_literal(v_c1) || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('estudiante no asistencias', 'A', 'select count(*) from attendances', 'ERR:permission denied'),
  ('estudiante no credenciales tabla', 'A', 'select count(*) from session_credentials', 'ERR:permission denied'),
  ('sorteo no overview', 'R', 'select session_checkin_overview()', 'ERR:NOT_AUTHORIZED'),
  ('sorteo no credenciales', 'R', 'select session_credential_display(' || quote_literal(v_c1) || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('sorteo no regenera', 'R', 'select regenerate_session_credential(' || quote_literal(v_c1) || '::uuid, ''filtracion'')', 'ERR:NOT_AUTHORIZED'),
  ('staff no regenera', 'S', 'select regenerate_session_credential(' || quote_literal(v_c1) || '::uuid, ''filtracion'')', 'ERR:NOT_AUTHORIZED'),
  ('cred inventado', 'A', 'select check_in(''0000000000000000000000000000000000000000000000000000000000000000'')', 'ERR:INVALID_CREDENTIAL'),
  ('cred incorrecto', 'A', 'select check_in(''ZZZZZZ'')', 'ERR:INVALID_CREDENTIAL'),
  ('cred vacio', 'A', 'select check_in('''')', 'ERR:INVALID_CREDENTIAL'),
  ('A C1 QR 1cred', 'A', 'select (check_in(' || quote_literal(v_c1_token) || ')->>''credits_granted'')::int = 1', 'TRUE'),
  ('B sin C2', 'B', 'select check_in(' || quote_literal(v_c2_token) || ')', 'ERR:NO_RESERVATION'),
  ('idem 2do QR', 'A', 'select (check_in(' || quote_literal(v_c1_token) || ')->>''already_registered'')::boolean', 'TRUE'),
  ('idem codigo', 'A', 'select (check_in(' || quote_literal(v_c1_code) || ')->>''already_registered'')::boolean', 'TRUE'),
  ('idem QR post codigo', 'A', 'select (check_in(' || quote_literal(v_c1_token) || ')->>''already_registered'')::boolean', 'TRUE'),
  ('A C2 2cred', 'A', 'select (check_in(' || quote_literal(v_c2_token) || ')->>''credits_granted'')::int = 2', 'TRUE'),
  ('2cred=1asist', 'P', 'select count(*) = 1 from attendances where participant_id = ' || quote_literal(v_pa) || '::uuid and session_id = ' || quote_literal(v_c2) || '::uuid', 'TRUE'),
  ('sellos=3', 'P', 'select my_stamp_count(' || quote_literal(v_pa) || '::uuid) = 3', 'TRUE'),
  ('talleres=2', 'P', 'select my_attended_workshop_count(' || quote_literal(v_pa) || '::uuid) = 2', 'TRUE'),
  ('snapshot: cambiar credits', 'P', 'update activity_sessions set credits = 9 where id = ' || quote_literal(v_c1) || '::uuid', 'OK'),
  ('snapshot: verificar', 'P', 'select credits_granted = 1 from attendances where participant_id = ' || quote_literal(v_pa) || '::uuid and session_id = ' || quote_literal(v_c1) || '::uuid', 'TRUE'),
  ('CF temprano', 'A', 'select check_in(' || quote_literal(v_cf_token) || ')', 'ERR:CHECKIN_TOO_EARLY'),
  ('cancelada', 'B', 'select check_in(' || quote_literal(v_cn_token) || ')', 'ERR:SESSION_CANCELLED'),
  ('B no C2', 'B', 'select check_in(' || quote_literal(v_c2_token) || ')', 'ERR:NO_RESERVATION'),
  ('coord overview', 'C', 'select jsonb_array_length(session_checkin_overview()) > 0', 'TRUE'),
  ('coord display', 'C', 'select (session_credential_display(' || quote_literal(v_c1) || '::uuid)->>''manual_code'') is not null', 'TRUE'),
  ('staff overview', 'S', 'select jsonb_array_length(session_checkin_overview()) > 0', 'TRUE'),
  ('staff display', 'S', 'select (session_credential_display(' || quote_literal(v_c1) || '::uuid)->>''manual_code'') is not null', 'TRUE'),
  ('regen nueva', 'C', 'select (regenerate_session_credential(' || quote_literal(v_co) || '::uuid, ''prueba'')->>''manual_code'') is not null', 'OK'),
  ('regen anterior no', 'A', 'select check_in(' || quote_literal(v_co_token) || ')', 'ERR:INVALID_CREDENTIAL'),
  ('progreso', 'A', 'select (my_progress()->>''stamps'')::int = 3 and (my_progress()->>''attended_workshops'')::int = 2', 'TRUE'),
  ('invariante', 'P', 'select not exists (select 1 from attendances group by participant_id, session_id having count(*) > 1)', 'TRUE');

  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_q := st.q;
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'A' THEN ua WHEN 'B' THEN ub WHEN 'N' THEN un END;
    v_val := NULL; v_err := NULL;
    BEGIN
      IF st.who = 'X' THEN
        PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
        PERFORM set_config('role', 'anon', true);
      ELSIF v_uid IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
      END IF;
      IF v_q LIKE 'update %' THEN EXECUTE v_q; ELSE EXECUTE v_q INTO v_val; END IF;
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
