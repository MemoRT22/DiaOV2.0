-- Regresión: intereses finales (post-evento). Un solo bloque DO, autocontenido; termina con RAISE EXCEPTION
-- ("N ok M fail: detalle") para revertir todo. No modifica triggers ni protecciones: los cambios a la edición
-- (mínimo de asistencias, fechas) y el fixture viven solo dentro de la transacción.
DO $test$
DECLARE
  ed uuid := active_edition_id();
  v_div uuid := (SELECT id FROM divisions ORDER BY sort_order LIMIT 1);
  v_ed editions%ROWTYPE;
  v_u uuid[] := ARRAY[]::uuid[]; v_p uuid[] := ARRAY[]::uuid[];
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c_inactive uuid; c_real uuid;
  a1 uuid; a2 uuid; a3 uuid; s1 uuid; s2 uuid; s3 uuid;
  v_id uuid; v_i int; v_n int; v_n2 int; v_err text; v_txt text; v_j jsonb; v_j2 jsonb;
    snap_init jsonb; snap_init2 jsonb; snap_rec jsonb; snap_rec2 jsonb; snap_part uuid; snap_part2 uuid;
  snap_cnt text; snap_cnt2 text;
  c_real_off uuid; v_ga text[]; v_ge text[]; v_glob text; v_glob2 text; p4_init jsonb; p4_init2 jsonb; p4_rec jsonb; p4_rec2 jsonb; p4_cnt text; p4_cnt2 text;
  v_pass int := 0; v_fail int := 0; v_res_str text := '';
BEGIN
  SELECT * INTO v_ed FROM editions WHERE id = ed;

  -- ===================== FIXTURE =====================
  FOR v_i IN 1..3 LOOP
    v_id := ('00000000-0000-4000-8000-' || lpad(to_hex(x'e100'::int + v_i), 12, '0'))::uuid;
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpe.p' || v_i || '@test.invalid', '{}', '{}', now(), now());
    v_u := v_u || v_id;
    INSERT INTO participants (edition_id, email, full_name, origin, is_demo, auth_user_id)
    VALUES (ed, 'rpe.p' || v_i || '@test.invalid', 'RPE P' || v_i, 'demo', true, v_id) RETURNING id INTO v_id;
    v_p := v_p || v_id;
    UPDATE participant_profiles SET platform_consent_version = v_ed.privacy_notice_version, platform_consent_at = now() WHERE participant_id = v_id;
  END LOOP;

  -- Participante REAL (P4) para probar el catálogo por entorno
  v_id := '00000000-0000-4000-8000-00000000e104'::uuid;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rpe.p4@test.invalid', '{}', '{}', now(), now());
  v_u := v_u || v_id;

  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-1', 'RPE Carrera 1', v_div, true, true) RETURNING id INTO c1;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-2', 'RPE Carrera 2', v_div, true, true) RETURNING id INTO c2;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-3', 'RPE Carrera 3', v_div, true, true) RETURNING id INTO c3;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-4', 'RPE Carrera 4', v_div, true, true) RETURNING id INTO c4;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-5', 'RPE Carrera 5', v_div, true, true) RETURNING id INTO c5;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-OFF', 'RPE Inactiva', v_div, true, false) RETURNING id INTO c_inactive;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-REAL', 'RPE Real', v_div, false, true) RETURNING id INTO c_real;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RPE-REAL-OFF', 'RPE Real Inactiva', v_div, false, false) RETURNING id INTO c_real_off;
  INSERT INTO participants (edition_id, email, full_name, origin, auth_user_id, initial_career_id)
  VALUES (ed, 'rpe.p4@test.invalid', 'RPE P4 real', 'forms', v_u[4], c_real) RETURNING id INTO v_id;
  v_p := v_p || v_id;
  UPDATE participant_profiles SET platform_consent_version = v_ed.privacy_notice_version, platform_consent_at = now() WHERE participant_id = v_id;
  PERFORM sync_initial_interests(v_id, ARRAY[c_real], ARRAY['rpe real']);

  -- Talleres: a1 y a2 (asistencias de P1), a3 (recomendable por la carrera inicial c1)
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo) VALUES (ed, v_div, 'RPE A1', '', 'A1', true) RETURNING id INTO a1;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo) VALUES (ed, v_div, 'RPE A2', '', 'A2', true) RETURNING id INTO a2;
  INSERT INTO activities (edition_id, division_id, title, description, location, is_demo) VALUES (ed, v_div, 'RPE A3', '', 'A3', true) RETURNING id INTO a3;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (a1, now() - interval '3 hours', now() - interval '2 hours 40 minutes', 10, 'A1', 'activa', true, 1) RETURNING id INTO s1;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (a2, now() - interval '2 hours', now() - interval '1 hour 40 minutes', 10, 'A2', 'activa', true, 1) RETURNING id INTO s2;
  INSERT INTO activity_sessions (activity_id, starts_at, ends_at, capacity, location, status, is_demo, credits)
  VALUES (a3, now() + interval '5 hours', now() + interval '5 hours 20 minutes', 10, 'A3', 'activa', true, 1) RETURNING id INTO s3;
  INSERT INTO activity_careers (activity_id, career_id) VALUES (a3, c1);

  -- Intereses iniciales de P1 (c1, c2) y una reservación (para comprobar independencia)
  PERFORM sync_initial_interests(v_p[1], ARRAY[c1, c2], ARRAY['rpe1', 'rpe2']);
  INSERT INTO reservations (participant_id, session_id, activity_id, status) VALUES (v_p[1], s3, a3, 'vigente');

  -- Regla de la edición: mínimo 2 asistencias, sin fecha de aviso ni de cierre
  UPDATE editions SET interests_prompt_min_attendances = 2, interests_prompt_at = NULL, interests_close_at = NULL WHERE id = ed;

  -- ===================== 0. Modelo / constraints =====================
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_name = 'post_event_interests' AND column_name IN ('participant_id','career_id','preference','created_at','updated_at');
  IF v_n = 5 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '0.cols[' || v_n || '] '; END IF;
  INSERT INTO post_event_interests (participant_id, preference, career_id) VALUES (v_p[3], 1, c1);
  v_err := NULL; BEGIN INSERT INTO post_event_interests (participant_id, preference, career_id) VALUES (v_p[3], 4, c2); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%preference_check%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '0.pref4[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN INSERT INTO post_event_interests (participant_id, preference, career_id) VALUES (v_p[3], 1, c2); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%pkey%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '0.dupPref[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN INSERT INTO post_event_interests (participant_id, preference, career_id) VALUES (v_p[3], 2, c1); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%career_id_key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '0.dupCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  DELETE FROM post_event_interests WHERE participant_id = v_p[3];

  -- Snapshots para la prueba de independencia (K)
  SELECT coalesce(jsonb_agg(to_jsonb(i) - 'updated_at' - 'created_at' ORDER BY preference), '[]') INTO snap_init FROM initial_interests i WHERE participant_id = v_p[1];
  SELECT initial_career_id INTO snap_part FROM participants WHERE id = v_p[1];
  -- ===================== I. Activación por número de asistencias (P1) =====================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_progress();
  IF (v_j->>'post_event_interests_prompt') = 'false' AND (v_j->>'post_event_interests_open') = 'true' AND (v_j->>'post_event_interests_completed') = 'false'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'I.before[' || v_j::text || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INTERESTS_NOT_AVAILABLE%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'I.saveBefore[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p[1], s1, a1, 1, 'qr');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_progress();
  IF (v_j->>'post_event_interests_prompt') = 'false' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'I.oneAtt[' || v_j::text || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO attendances (participant_id, session_id, activity_id, credits_granted, method) VALUES (v_p[1], s2, a2, 1, 'qr');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_progress();
  IF (v_j->>'post_event_interests_prompt') = 'true' AND (v_j->>'interests_prompt') = 'true'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'I.minReached[' || v_j::text || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  snap_cnt := (SELECT count(*) FROM reservations WHERE participant_id = v_p[1]) || '/' || (SELECT count(*) FROM attendances WHERE participant_id = v_p[1]) || '/' || my_stamp_count(v_p[1]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  snap_rec := my_recommended_activities();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  IF jsonb_array_length(snap_rec->'recommendations') >= 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'K.recsNotEmpty[' || snap_rec::text || '] '; END IF;

  -- ===================== J. Activación por fecha (P2 sin asistencias) =====================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[2], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[2])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_progress();
  IF (v_j->>'post_event_interests_prompt') = 'false' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'J.before[' || v_j::text || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE editions SET interests_prompt_at = now() - interval '1 minute' WHERE id = ed;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[2], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[2])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_progress();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_n FROM attendances WHERE participant_id = v_p[2];
  IF (v_j->>'post_event_interests_prompt') = 'true' AND v_n = 0
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'J.byDate[' || v_j::text || '/' || v_n || '] '; END IF;

  SELECT (SELECT count(*) FROM reservations) || '/' || (SELECT count(*) FROM attendances) || '/' || (SELECT coalesce(sum(credits_granted), 0) FROM attendances)
         || '/' || (SELECT count(*) FROM activity_credentials) || '/' || (SELECT count(*) FROM initial_interests) INTO v_glob;

  -- ===================== A-F. Guardar =====================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  -- A: una carrera
  PERFORM save_post_event_interests(ARRAY[c1]);
  SELECT count(*), min(preference) INTO v_n, v_n2 FROM post_event_interests;  -- RLS: solo propias
  IF v_n = 1 AND v_n2 = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'A.one[' || v_n || '/' || v_n2 || '] '; END IF;
  v_j := my_post_event_interests();
  IF (v_j->>'post_event_interests_completed') = 'true' AND v_j->'career_ids' = to_jsonb(ARRAY[c1]) THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'A.rpc[' || v_j::text || '] '; END IF;
  -- B: tres carreras
  PERFORM save_post_event_interests(ARRAY[c1, c2, c3]);
  SELECT count(*), string_agg(preference::text || ':' || (career_id = ANY (ARRAY[c1, c2, c3]))::text, ',' ORDER BY preference) INTO v_n, v_err FROM post_event_interests;
  IF v_n = 3 AND v_err = '1:true,2:true,3:true' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'B.three[' || v_n || '/' || coalesce(v_err, 'null') || '] '; END IF;
  SELECT string_agg(career_id::text, ',' ORDER BY preference) INTO v_err FROM post_event_interests;
  IF v_err = c1 || ',' || c2 || ',' || c3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'B.order[' || v_err || '] '; END IF;
  -- C: cuatro
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1, c2, c3, c4]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%TOO_MANY_INTERESTS%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'C.four[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- D: duplicados
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1, c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%DUPLICATE_INTEREST%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'D.dup[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- E: inexistente / inactiva / otro entorno / NULL
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[gen_random_uuid()]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.missing[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_inactive]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.inactive[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_real]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.otherEnv[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1, NULL]::uuid[]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.nullElem[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(NULL); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_INPUT%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.nullArr[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- los rechazos no tocaron la selección vigente [c1,c2,c3]
  SELECT string_agg(career_id::text, ',' ORDER BY preference) INTO v_err FROM post_event_interests;
  IF v_err = c1 || ',' || c2 || ',' || c3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'E.untouched[' || coalesce(v_err, 'null') || '] '; END IF;
  -- F: reemplazo [A,B,C] -> [C,D]
  PERFORM save_post_event_interests(ARRAY[c3, c4]);
  SELECT count(*), string_agg(career_id::text || '→' || preference::text, ',' ORDER BY preference) INTO v_n, v_err FROM post_event_interests;
  IF v_n = 2 AND v_err = c3 || '→1,' || c4 || '→2' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'F.replace[' || v_n || '/' || coalesce(v_err, 'null') || '] '; END IF;
  -- idempotencia: repetir no escribe (updated_at intacto) y reordenar sí cambia
  SELECT string_agg(ctid::text, ',' ORDER BY preference) INTO v_err FROM post_event_interests;
  PERFORM save_post_event_interests(ARRAY[c3, c4]);
  SELECT string_agg(ctid::text, ',' ORDER BY preference) INTO v_txt FROM post_event_interests;
  SELECT count(*) INTO v_n FROM post_event_interests;
  IF v_err = v_txt AND v_n = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'F.idempotent[' || v_n || '] '; END IF;
  PERFORM save_post_event_interests(ARRAY[c4, c3]);
  SELECT string_agg(career_id::text, ',' ORDER BY preference) INTO v_err FROM post_event_interests;
  IF v_err = c4 || ',' || c3 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'F.reorder[' || coalesce(v_err, 'null') || '] '; END IF;
  PERFORM save_post_event_interests(ARRAY[c3, c4]);  -- deja la selección final en [c3, c4]

  -- ===================== K. Independencia de los intereses iniciales =====================
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT coalesce(jsonb_agg(to_jsonb(i) - 'updated_at' - 'created_at' ORDER BY preference), '[]') INTO snap_init2 FROM initial_interests i WHERE participant_id = v_p[1];
  SELECT initial_career_id INTO snap_part2 FROM participants WHERE id = v_p[1];
  snap_cnt2 := (SELECT count(*) FROM reservations WHERE participant_id = v_p[1]) || '/' || (SELECT count(*) FROM attendances WHERE participant_id = v_p[1]) || '/' || my_stamp_count(v_p[1]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  snap_rec2 := my_recommended_activities();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  IF snap_init = snap_init2 AND jsonb_array_length(snap_init) = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'K.initial[' || snap_init::text || ' vs ' || snap_init2::text || '] '; END IF;
  IF snap_part IS NOT DISTINCT FROM snap_part2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'K.initialCareerId[] '; END IF;
  IF snap_rec = snap_rec2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'K.recs[' || snap_rec::text || ' vs ' || snap_rec2::text || '] '; END IF;
  IF snap_cnt = snap_cnt2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'K.counts[' || snap_cnt || ' vs ' || snap_cnt2 || '] '; END IF;

  -- ===================== G. Aislamiento =====================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[2], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[2])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_n FROM post_event_interests;  -- P2 aún no guardó: no ve las de P1
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.cannotSee[' || v_n || '] '; END IF;
  v_j := my_post_event_interests();
  IF v_j->'career_ids' = '[]'::jsonb AND (v_j->>'post_event_interests_completed') = 'false' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.rpcOwn[' || v_j::text || '] '; END IF;
  PERFORM save_post_event_interests(ARRAY[c5]);
  SELECT count(*) INTO v_n FROM post_event_interests WHERE participant_id = v_p[1];
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.filterOther[' || v_n || '] '; END IF;
  v_err := NULL; BEGIN UPDATE post_event_interests SET career_id = c5 WHERE participant_id = v_p[1]; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.updateDenied[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN DELETE FROM post_event_interests WHERE participant_id = v_p[1]; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.deleteDenied[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN INSERT INTO post_event_interests (participant_id, preference, career_id) VALUES (v_p[1], 3, c5); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.insertDenied[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN TRUNCATE post_event_interests; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.truncateDenied[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- anon: sin acceso a las RPC ni a la tabla; la función interna no es ejecutable por participantes
  v_err := NULL; BEGIN PERFORM post_event_interests_state(v_p[1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.stateInternal[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'anon', true); PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.anonSave[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM my_post_event_interests(); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.anonRead[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM count(*) FROM post_event_interests; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%permission denied%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.anonTable[' || coalesce(v_err, 'ok') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO v_n FROM post_event_interests WHERE participant_id = v_p[1];
  IF v_n = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'G.p1Intact[' || v_n || '] '; END IF;

  -- ===================== L. Catálogo seleccionable alineado con el entorno =====================
  -- demo (P2)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[2], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[2])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_j := my_post_event_interests();
  SELECT array_agg(x->>'id' ORDER BY x->>'id') INTO v_ga FROM jsonb_array_elements(v_j->'careers') x;
  SELECT array_agg(id::text ORDER BY id::text) INTO v_ge FROM careers WHERE is_active AND is_demo;
  IF v_ga = v_ge THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.demoCatalog[' || coalesce(v_ga::text, 'null') || ' vs ' || coalesce(v_ge::text, 'null') || '] '; END IF;
  IF c1::text = ANY (v_ga) AND NOT (c_real::text = ANY (v_ga)) AND NOT (c_real_off::text = ANY (v_ga)) AND NOT (c_inactive::text = ANY (v_ga))
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.demoMembers[] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_real]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.demoRejectsReal[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_inactive]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.demoRejectsInactive[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.demoAllowsDemo[' || coalesce(v_err, '?') || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);

  -- real (P4)
  SELECT coalesce(jsonb_agg(to_jsonb(i) - 'updated_at' - 'created_at' ORDER BY preference), '[]') INTO p4_init FROM initial_interests i WHERE participant_id = v_p[4];
  p4_cnt := (SELECT count(*) FROM reservations WHERE participant_id = v_p[4]) || '/' || (SELECT count(*) FROM attendances WHERE participant_id = v_p[4]) || '/' || my_stamp_count(v_p[4]);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[4], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[4])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  p4_rec := my_recommended_activities();
  v_j := my_post_event_interests();
  SELECT array_agg(x->>'id' ORDER BY x->>'id') INTO v_ga FROM jsonb_array_elements(v_j->'careers') x;
  SELECT array_agg(id::text ORDER BY id::text) INTO v_ge FROM careers WHERE is_active AND NOT is_demo;
  IF v_ga = v_ge THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realCatalog[' || coalesce(v_ga::text, 'null') || ' vs ' || coalesce(v_ge::text, 'null') || '] '; END IF;
  IF c_real::text = ANY (v_ga) AND NOT (c1::text = ANY (v_ga)) AND NOT (c_real_off::text = ANY (v_ga)) AND NOT (c_inactive::text = ANY (v_ga))
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realMembers[] '; END IF;
  IF (v_j->>'post_event_interests_prompt') = 'true' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realPrompt[' || v_j::text || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realRejectsDemo[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_real_off]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realRejectsInactive[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_real, c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realRejectsMixed[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c_real]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realAllowsReal[' || coalesce(v_err, '?') || '] '; END IF;
  SELECT count(*), min(preference) INTO v_n, v_n2 FROM post_event_interests;
  IF v_n = 1 AND v_n2 = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realSaved[' || v_n || '/' || v_n2 || '] '; END IF;
  p4_rec2 := my_recommended_activities();
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT coalesce(jsonb_agg(to_jsonb(i) - 'updated_at' - 'created_at' ORDER BY preference), '[]') INTO p4_init2 FROM initial_interests i WHERE participant_id = v_p[4];
  p4_cnt2 := (SELECT count(*) FROM reservations WHERE participant_id = v_p[4]) || '/' || (SELECT count(*) FROM attendances WHERE participant_id = v_p[4]) || '/' || my_stamp_count(v_p[4]);
  IF p4_init = p4_init2 AND jsonb_array_length(p4_init) = 1 AND p4_rec = p4_rec2 AND p4_cnt = p4_cnt2
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.realIndependent[' || p4_cnt || ' vs ' || p4_cnt2 || '] '; END IF;
  -- global: reservas, asistencias, créditos, QR e intereses iniciales no cambian por guardar intereses finales
  SELECT (SELECT count(*) FROM reservations) || '/' || (SELECT count(*) FROM attendances) || '/' || (SELECT coalesce(sum(credits_granted), 0) FROM attendances)
         || '/' || (SELECT count(*) FROM activity_credentials) || '/' || (SELECT count(*) FROM initial_interests) INTO v_glob2;
  IF v_glob = v_glob2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'L.global[' || v_glob || ' vs ' || v_glob2 || '] '; END IF;

  -- ===================== H. Ventana cerrada =====================
  UPDATE editions SET interests_close_at = now() - interval '1 minute' WHERE id = ed;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[c1]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INTERESTS_CLOSED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'H.saveClosed[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM save_post_event_interests(ARRAY[]::uuid[]); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INTERESTS_CLOSED%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'H.clearClosed[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_j := my_post_event_interests();
  IF (v_j->>'post_event_interests_open') = 'false' AND (v_j->>'post_event_interests_can_edit') = 'false'
     AND (v_j->>'post_event_interests_completed') = 'true' AND v_j->'career_ids' = to_jsonb(ARRAY[c3, c4])
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'H.readClosed[' || v_j::text || '] '; END IF;
  v_j2 := my_progress();
  IF (v_j2->>'post_event_interests_open') = 'false' AND (v_j2->>'interests_open') = 'false' AND (v_j2->>'post_event_interests_completed') = 'true'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'H.progressClosed[' || v_j2::text || '] '; END IF;
  SELECT count(*) INTO v_n FROM post_event_interests;
  IF v_n = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'H.rowsKept[' || v_n || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ===================== Vaciar =====================
  UPDATE editions SET interests_close_at = NULL WHERE id = ed;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true); PERFORM set_config('request.jwt.claim.sub', (v_u[1])::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM save_post_event_interests(ARRAY[]::uuid[]);
  SELECT count(*) INTO v_n FROM post_event_interests;
  v_j := my_post_event_interests();
  IF v_n = 0 AND (v_j->>'post_event_interests_completed') = 'false' AND (v_j->>'post_event_interests_can_edit') = 'true'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || 'Z.clear[' || v_n || '/' || v_j::text || '] '; END IF;
  PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);

  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, coalesce(nullif(v_res_str, ''), '(none)');
END
$test$;
