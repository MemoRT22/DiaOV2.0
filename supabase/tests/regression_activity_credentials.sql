-- Pruebas de regresión Fase 8B — QR único por taller
-- Se ejecuta como un solo bloque DO. Siempre termina con RAISE EXCEPTION que trae los resultados.

DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000b1';
  s uuid := '00000000-0000-4000-8000-0000000000b2';
  r uuid := '00000000-0000-4000-8000-0000000000b3';
  ua uuid := '00000000-0000-4000-8000-0000000000b4';
  ub uuid := '00000000-0000-4000-8000-0000000000b5';
  uc uuid := '00000000-0000-4000-8000-0000000000b6';
  ud uuid := '00000000-0000-4000-8000-0000000000b7';
  ue uuid := '00000000-0000-4000-8000-0000000000b8';
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_act1 uuid; v_act2 uuid; v_act3 uuid;
  v_s1a uuid; v_s1b uuid; v_s1c uuid; v_s1d uuid;
  v_s1early uuid; v_s1late uuid; v_s1cancel uuid;
  v_s2 uuid;
  v_pid uuid; v_pid2 uuid; v_pid3 uuid; v_pid4 uuid; v_pid5 uuid;
  v_cred1 jsonb; v_cred2 jsonb;
  v_token1 text; v_code1 text; v_token2 text; v_code2 text;
  v_new_cred jsonb; v_new_token1 text;
  v_token3 text;
  st record;
  v_uid uuid; v_q text; v_val text; v_err text; v_ok boolean;
  v_res_str text := ''; v_pass int := 0; v_fail int := 0;
BEGIN
  -- ====== FIXTURE ======
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt8b.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, s, r, ua, ub, uc, ud, ue]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES
    (c, 'coordinacion', 'RT8B Coord', true, 'rt8b.c1@test.invalid'),
    (s, 'staff', 'RT8B Staff', true, 'rt8b.c2@test.invalid'),
    (r, 'sorteo', 'RT8B Sorteo', true, 'rt8b.c3@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion'), (s, 'staff'), (r, 'sorteo');

  -- Activity 1: Creación de crepas
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8B Crepas', '', 'Edificio A', true) RETURNING id INTO v_act1;
  -- Activity 2: Finanzas
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8B Finanzas', '', 'Edificio B', true) RETURNING id INTO v_act2;
  -- Activity 3: for cancelled session test
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8B Diseño', '', 'Edificio C', true) RETURNING id INTO v_act3;

  -- Sessions for activity 1: within window
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() - interval '35 min', now() - interval '15 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1a;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() - interval '22 min', now() - interval '2 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1b;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() - interval '19 min', now() + interval '1 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1c;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() + interval '70 min', now() + interval '90 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1d;

  -- Session for activity 2
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act2, now() - interval '19 min', now() + interval '1 min', 4, 'Edificio B', 'activa', true, 1) RETURNING id INTO v_s2;

  -- Session for activity 1 — far future (for TOO_EARLY test, uc)
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() + interval '120 min', now() + interval '140 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1early;

  -- Session for activity 1 — long past (for TOO_LATE test, ud)
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act1, now() - interval '120 min', now() - interval '100 min', 4, 'Edificio A', 'activa', true, 1) RETURNING id INTO v_s1late;

  -- Session for activity 3 — will be cancelled (for SESSION_CANCELLED test, ue)
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act3, now() - interval '19 min', now() + interval '1 min', 4, 'Edificio C', 'activa', true, 1) RETURNING id INTO v_s1cancel;

  -- Participants
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8b.a@test.invalid', 'Ana Test OchoB', '2008-01-01', 'demo', true, ua);
  SELECT id INTO v_pid FROM participants WHERE email = 'rt8b.a@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid;

  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8b.b@test.invalid', 'Beto Test OchoB', '2008-02-02', 'demo', true, ub);
  SELECT id INTO v_pid2 FROM participants WHERE email = 'rt8b.b@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid2;

  -- Participant uc: reserved far-future session (TOO_EARLY)
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8b.c@test.invalid', 'Carlos Test OchoB', '2008-03-03', 'demo', true, uc);
  SELECT id INTO v_pid3 FROM participants WHERE email = 'rt8b.c@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid3;

  -- Participant ud: reserved long-past session (TOO_LATE)
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8b.d@test.invalid', 'Dora Test OchoB', '2008-04-04', 'demo', true, ud);
  SELECT id INTO v_pid4 FROM participants WHERE email = 'rt8b.d@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid4;

  -- Participant ue: reserved session that will be cancelled (SESSION_CANCELLED)
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8b.e@test.invalid', 'Elena Test OchoB', '2008-05-05', 'demo', true, ue);
  SELECT id INTO v_pid5 FROM participants WHERE email = 'rt8b.e@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid5;

  -- Reservations
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid, v_s1b, v_act1, 'vigente');
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid2, v_s1c, v_act1, 'vigente');
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid3, v_s1early, v_act1, 'vigente');
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid4, v_s1late, v_act1, 'vigente');
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid5, v_s1cancel, v_act3, 'vigente');

  -- Get credential tokens
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT * INTO v_cred1 FROM activity_credential_display(v_act1);
  SELECT * INTO v_cred2 FROM activity_credential_display(v_act2);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_token1 := v_cred1->>'qr_token';
  v_code1 := v_cred1->>'manual_code';
  v_token2 := v_cred2->>'qr_token';
  v_code2 := v_cred2->>'manual_code';

  -- Get act3 token for cancelled session test
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT (ac->>'qr_token') INTO v_token3 FROM activity_credential_display(v_act3) ac;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  CREATE TEMP TABLE rt_steps (seq serial, name text, who text, q text, expect text) ON COMMIT DROP;
  INSERT INTO rt_steps (name, who, q, expect) VALUES
  -- ===== Credencial: una por actividad =====
  ('cred: 1 cred act1', 'P', 'select count(*) = 1 from activity_credentials where activity_id = ' || quote_literal(v_act1) || '::uuid', 'TRUE'),
  ('cred: 1 cred act2', 'P', 'select count(*) = 1 from activity_credentials where activity_id = ' || quote_literal(v_act2) || '::uuid', 'TRUE'),
  ('cred: act1 tiene 6 sesiones 1 cred', 'P', 'select (select count(*) from activity_credentials where activity_id = ' || quote_literal(v_act1) || '::uuid) = 1 and (select count(*) from activity_sessions where activity_id = ' || quote_literal(v_act1) || '::uuid) >= 4', 'TRUE'),
  ('cred: credenciales distintas', 'P', 'select count(distinct qr_token_hash) >= 2 from activity_credentials where activity_id in (' || quote_literal(v_act1) || '::uuid, ' || quote_literal(v_act2) || '::uuid)', 'TRUE'),
  ('cred: nueva sesión no crea cred', 'P', 'insert into activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits) values (' || quote_literal(v_act1) || '::uuid, now() + interval ''90 min'', now() + interval ''110 min'', 4, ''Edificio A'', ''activa'', true, 1)', 'OK'),
  ('cred: sigue 1 cred', 'P', 'select count(*) = 1 from activity_credentials where activity_id = ' || quote_literal(v_act1) || '::uuid', 'TRUE'),
  ('cred: session_credentials truncada', 'P', 'select count(*) = 0 from session_credentials', 'TRUE'),
  -- ===== Resolución =====
  ('resolv: Ana check-in QR crepas', 'A', 'select (check_in(' || quote_literal(v_token1) || ')->>''already_registered'') = ''false''', 'TRUE'),
  ('resolv: Ana en sesión 1b', 'P', 'select count(*) = 1 from attendances where participant_id = ' || quote_literal(v_pid) || '::uuid and session_id = ' || quote_literal(v_s1b) || '::uuid', 'TRUE'),
  ('resolv: Ana créditos', 'P', 'select credits_granted = 1 from attendances where participant_id = ' || quote_literal(v_pid) || '::uuid and session_id = ' || quote_literal(v_s1b) || '::uuid', 'TRUE'),
  -- ===== Idempotencia =====
  ('idem: Ana otra vez already', 'A', 'select (check_in(' || quote_literal(v_token1) || ')->>''already_registered'') = ''true''', 'TRUE'),
  ('idem: 1 asistencia', 'P', 'select count(*) = 1 from attendances where participant_id = ' || quote_literal(v_pid) || '::uuid', 'TRUE'),
  -- ===== Dos alumnos, mismo QR, distintas sesiones =====
  ('dual: Beto mismo QR sesión 1c', 'B', 'select (check_in(' || quote_literal(v_token1) || ')->>''already_registered'') = ''false''', 'TRUE'),
  ('dual: Beto en 1c', 'P', 'select count(*) = 1 from attendances where participant_id = ' || quote_literal(v_pid2) || '::uuid and session_id = ' || quote_literal(v_s1c) || '::uuid', 'TRUE'),
  ('dual: Ana 1b Beto 1c', 'P', 'select count(distinct session_id) = 2 from attendances where participant_id in (' || quote_literal(v_pid) || '::uuid, ' || quote_literal(v_pid2) || '::uuid)', 'TRUE'),
  -- ===== Sin reservación =====
  ('nores: Ana finanzas sin res', 'A', 'select check_in(' || quote_literal(v_token2) || ')', 'ERR:NO_RESERVATION'),
  -- ===== Código manual =====
  ('manual: código resuelve taller', 'P', 'select (resolve_credential(' || quote_literal(v_code1) || ')).activity_id = ' || quote_literal(v_act1) || '::uuid', 'TRUE'),
  -- ===== Ventana temporal =====
  ('ventana: Carlos TOO_EARLY (sesión lejana)', 'F', 'select check_in(' || quote_literal(v_token1) || ')', 'ERR:CHECKIN_TOO_EARLY'),
  ('ventana: Dora TOO_LATE (sesión pasada)', 'G', 'select check_in(' || quote_literal(v_token1) || ')', 'ERR:CHECKIN_TOO_LATE'),
  -- ===== Sesión cancelada =====
  ('cancel: cancelar sesión reservada de Elena', 'P', 'update activity_sessions set status = ''cancelada'' where id = ' || quote_literal(v_s1cancel) || '::uuid', 'OK'),
  ('cancel: Elena escanea y obtiene SESSION_CANCELLED', 'H', 'select check_in(' || quote_literal(v_token3) || ')', 'ERR:SESSION_CANCELLED'),
  -- ===== Regeneración =====
  ('regen: Staff no regenera', 'S', 'select regenerate_activity_credential(' || quote_literal(v_act2) || '::uuid, ''motivo test'')', 'ERR:NOT_AUTHORIZED'),
  ('regen: Sorteo no regenera', 'R', 'select regenerate_activity_credential(' || quote_literal(v_act2) || '::uuid, ''motivo test'')', 'ERR:NOT_AUTHORIZED'),
  ('regen: Coord regenera act2', 'C', 'select (regenerate_activity_credential(' || quote_literal(v_act2) || '::uuid, ''motivo test regeneracion'')->>''qr_token'') is not null', 'TRUE'),
  ('regen: token anterior act2 inválido', 'A', 'select check_in(' || quote_literal(v_token2) || ')', 'ERR:INVALID_CREDENTIAL'),
  ('regen: auditoría act2', 'P', 'select count(*) > 0 from audit_log where action = ''checkin.credential_regenerated'' and detail->>''activity_id'' = ' || quote_literal(v_act2) || '::text', 'TRUE'),
  -- ===== Seguridad: session_to_activity =====
  ('s2a: Staff permitido', 'S', 'select session_to_activity(' || quote_literal(v_s1a) || '::uuid) = ' || quote_literal(v_act1) || '::uuid', 'TRUE'),
  ('s2a: Coord permitido', 'C', 'select session_to_activity(' || quote_literal(v_s1a) || '::uuid) = ' || quote_literal(v_act1) || '::uuid', 'TRUE'),
  ('s2a: participante bloqueado', 'A', 'select session_to_activity(' || quote_literal(v_s1a) || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('s2a: Sorteo bloqueado', 'R', 'select session_to_activity(' || quote_literal(v_s1a) || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('s2a: anon bloqueado', 'X', 'select session_to_activity(' || quote_literal(v_s1a) || '::uuid)', 'ERR:permission denied'),
  -- ===== Seguridad general =====
  ('seg: participante no ve cred', 'A', 'select activity_credential_display(' || quote_literal(v_act1) || '::uuid)', 'ERR:NOT_AUTHORIZED'),
  ('seg: anon no check_in', 'X', 'select check_in(' || quote_literal(v_token1) || ')', 'ERR:permission denied'),
  ('seg: anon no ve cred', 'X', 'select activity_credential_display(' || quote_literal(v_act1) || '::uuid)', 'ERR:permission denied'),
  ('seg: Staff ve cred', 'S', 'select (activity_credential_display(' || quote_literal(v_act1) || '::uuid)->>''qr_token'') is not null', 'TRUE'),
  ('seg: Coord ve cred', 'C', 'select (activity_credential_display(' || quote_literal(v_act1) || '::uuid)->>''qr_token'') is not null', 'TRUE'),
  ('seg: overview talleres', 'S', 'select jsonb_array_length(activity_checkin_overview()) >= 1', 'TRUE'),
  ('seg: Sorteo no ve cred', 'R', 'select activity_credential_display(' || quote_literal(v_act1) || '::uuid)', 'ERR:NOT_AUTHORIZED');

  FOR st IN SELECT * FROM rt_steps ORDER BY seq LOOP
    v_q := st.q;
    v_uid := CASE st.who WHEN 'C' THEN c WHEN 'S' THEN s WHEN 'R' THEN r WHEN 'A' THEN ua WHEN 'B' THEN ub WHEN 'F' THEN uc WHEN 'G' THEN ud WHEN 'H' THEN ue END;
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
    ELSE v_fail := v_fail + 1; v_res_str := v_res_str || st.name || '[' || coalesce('err:' || v_err, 'val:' || coalesce(v_val, 'null')) || '] '; END IF;
  END LOOP;
  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, v_res_str;
END
$test$;
