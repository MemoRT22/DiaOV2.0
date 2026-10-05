-- Fase 8C: Regresión de reservaciones progresivas y ruta activa
DO $test$
DECLARE
  c uuid := '00000000-0000-4000-8000-0000000000c1';
  ua uuid := '00000000-0000-4000-8000-0000000000c2';
  ub uuid := '00000000-0000-4000-8000-0000000000c3';
  uc uuid := '00000000-0000-4000-8000-0000000000c4';
  ud uuid := '00000000-0000-4000-8000-0000000000c5';
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_act_a uuid; v_act_b uuid; v_act_c uuid; v_act_d uuid; v_act_e uuid; v_act_f uuid;
  v_s_a1 uuid; v_s_a2 uuid; v_s_b uuid; v_s_c uuid; v_s_d uuid; v_s_e uuid; v_s_conflict uuid;
  v_pid uuid; v_pid2 uuid; v_pid3 uuid; v_pid4 uuid;
  v_cred_a jsonb; v_token_a text; v_rv jsonb; v_ri int;
  v_err text; v_pass int := 0; v_fail int := 0;
  v_res_str text := '';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rt8c.' || right(u::text, 2) || '@test.invalid', '{}', '{}', now(), now()
  FROM unnest(ARRAY[c, ua, ub, uc, ud]) u;
  INSERT INTO staff_members (user_id, role, full_name, is_active, email) VALUES (c, 'coordinacion', 'RT8C Coord', true, 'rt8c.c1@test.invalid');
  INSERT INTO staff_roles (user_id, role) VALUES (c, 'coordinacion');

  -- Activities A-F
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C A', '', 'A', true) RETURNING id INTO v_act_a;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C B', '', 'B', true) RETURNING id INTO v_act_b;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C C', '', 'C', true) RETURNING id INTO v_act_c;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C D', '', 'D', true) RETURNING id INTO v_act_d;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C E', '', 'E', true) RETURNING id INTO v_act_e;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo)
  VALUES (ed, v_div, 'RT8C F', '', 'F', true) RETURNING id INTO v_act_f;

  -- All sessions start in the future (so they can be reserved)
  -- A1: starts +30min, ends +50min (will be moved into check-in window later)
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_a, now() + interval '30 min', now() + interval '50 min', 4, 'A', 'activa', true, 1) RETURNING id INTO v_s_a1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_a, now() + interval '70 min', now() + interval '90 min', 4, 'A', 'activa', true, 2) RETURNING id INTO v_s_a2;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_b, now() + interval '100 min', now() + interval '120 min', 4, 'B', 'activa', true, 1) RETURNING id INTO v_s_b;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_c, now() + interval '130 min', now() + interval '150 min', 4, 'C', 'activa', true, 1) RETURNING id INTO v_s_c;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_d, now() + interval '160 min', now() + interval '180 min', 4, 'D', 'activa', true, 1) RETURNING id INTO v_s_d;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_e, now() + interval '190 min', now() + interval '210 min', 4, 'E', 'activa', true, 1) RETURNING id INTO v_s_e;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (v_act_f, now() + interval '190 min', now() + interval '210 min', 4, 'F', 'activa', true, 1) RETURNING id INTO v_s_conflict;

  -- Participants
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8c.a@test.invalid', 'Ana 8C', '2008-01-01', 'demo', true, ua);
  SELECT id INTO v_pid FROM participants WHERE email = 'rt8c.a@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8c.b@test.invalid', 'Beto 8C', '2008-02-02', 'demo', true, ub);
  SELECT id INTO v_pid2 FROM participants WHERE email = 'rt8c.b@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid2;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8c.c@test.invalid', 'Carlos 8C', '2008-03-03', 'demo', true, uc);
  SELECT id INTO v_pid3 FROM participants WHERE email = 'rt8c.c@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid3;
  INSERT INTO participants (edition_id, email, full_name, birth_date, origin, is_demo, auth_user_id)
  VALUES (ed, 'rt8c.d@test.invalid', 'Dora 8C', '2008-04-04', 'demo', true, ud);
  SELECT id INTO v_pid4 FROM participants WHERE email = 'rt8c.d@test.invalid';
  UPDATE participant_profiles SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
  FROM editions e WHERE e.id = ed AND participant_profiles.participant_id = v_pid4;

  -- Get credential for A (as coordinacion)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT * INTO v_cred_a FROM activity_credential_display(v_act_a);
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  v_token_a := v_cred_a->>'qr_token';

  -- ===== 1. Límite progresivo =====
  -- Reserve A, B, C, D as Ana (all future, no reservations exist yet)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_a1); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resA[' || COALESCE(v_err,'?') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_b); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resB[' || COALESCE(v_err,'?') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_c); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resC[' || COALESCE(v_err,'?') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_d); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resD[' || COALESCE(v_err,'?') || '] '; END IF;

  -- active=4
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT active_reservation_count(v_pid) INTO v_ri;
  IF v_ri = 4 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.act4[' || v_ri || '] '; END IF;

  -- reserve E → MAX_RESERVATIONS
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_e); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%MAX_RESERVATIONS%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.maxR[' || COALESCE(v_err, 'ok') || '] '; END IF;

  -- Move A1 into check-in window: starts 22min ago, ends 2min ago
  -- (bypass guard trigger by setting diaov.location_change — actually times are locked if reservations exist)
  -- Use direct update with set_config to bypass guard
  PERFORM set_config('diaov.location_change', v_s_a1::text, true);
  UPDATE activity_sessions SET starts_at = now() - interval '22 min', ends_at = now() - interval '2 min' WHERE id = v_s_a1;
  PERFORM set_config('diaov.location_change', '', true);

  -- check-in A (A1 now in check-in window: ends 2min ago, within close_after window)
  v_err := NULL; BEGIN SELECT check_in(v_token_a) INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.chkA[' || COALESCE(v_err,'?') || '] '; END IF;

  -- active=3 (A has attendance, no longer counts)
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT active_reservation_count(v_pid) INTO v_ri;
  IF v_ri = 3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.act3[' || v_ri || '] '; END IF;

  -- reserve E → ok now
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_e); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.resE[' || COALESCE(v_err,'?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT active_reservation_count(v_pid) INTO v_ri;
  IF v_ri = 4 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.act4b[' || v_ri || '] '; END IF;

  -- ===== 3. Sin reservación =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uc, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN SELECT check_in(v_token_a) INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%NO_RESERVATION%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.noRes[' || COALESCE(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_ri FROM attendances WHERE participant_id = v_pid3;
  IF v_ri = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.carlos0[' || v_ri || '] '; END IF;

  -- ===== 4. Horario perdido =====
  -- Dora has a manual vigente on A1 (which ended). Reserve A2 → should expire old and succeed.
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_pid4, v_s_a1, v_act_a, 'vigente');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ud, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_a2); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.doraA2[' || COALESCE(v_err,'?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_ri FROM reservations WHERE participant_id = v_pid4 AND activity_id = v_act_a AND status = 'expirada';
  IF v_ri = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.exp[' || v_ri || '] '; END IF;
  SELECT count(*) INTO v_ri FROM reservations WHERE participant_id = v_pid4 AND activity_id = v_act_a AND status = 'vigente';
  IF v_ri = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.vig[' || v_ri || '] '; END IF;
  SELECT active_reservation_count(v_pid4) INTO v_ri;
  IF v_ri = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.doraAct[' || v_ri || '] '; END IF;

  -- ===== 5. ALREADY_ATTENDED =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_a2); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%ALREADY_ATTENDED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.att[' || COALESCE(v_err, 'ok') || '] '; END IF;

  -- ===== 6. Una asistencia =====
  v_err := NULL; BEGIN SELECT check_in(v_token_a) INTO v_rv; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL AND (v_rv->>'already_registered') = 'true' THEN v_pass := v_pass + 1;
  ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '6.rescan[err:' || COALESCE(v_err, 'null') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_ri FROM attendances WHERE participant_id = v_pid AND activity_id = v_act_a;
  IF v_ri = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '6.oneAtt[' || v_ri || '] '; END IF;
  SELECT credits_granted INTO v_ri FROM attendances WHERE participant_id = v_pid AND activity_id = v_act_a;
  IF v_ri = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '6.cred[' || v_ri || '] '; END IF;

  -- ===== 8. Conflictos =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_c); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '8.bC[' || COALESCE(v_err,'?') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_e); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '8.bE[' || COALESCE(v_err,'?') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM reserve_session(v_s_conflict); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SCHEDULE_CONFLICT%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '8.conf[' || COALESCE(v_err, 'ok') || '] '; END IF;

  -- ===== 9. Seguridad =====
  PERFORM set_config('role', 'anon', true); PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  v_err := NULL; BEGIN PERFORM active_reservation_count(v_pid); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '9.anon[' || COALESCE(v_err, 'ok') || '] '; END IF;

  -- ===== 11. Unique index =====
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
  v_err := NULL;
  BEGIN
    INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method)
    VALUES (v_pid, v_s_a2, v_act_a, 1, 'qr');
  EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%unique%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '11.dup[' || COALESCE(v_err, 'ok') || '] '; END IF;

  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, COALESCE(v_res_str, '(none)');
END
$test$;
