-- Regresión: capa de datos de propuestas de talleres (workshop_submissions). Un solo bloque DO, autocontenido;
-- termina con RAISE EXCEPTION ("N ok M fail: detalle") para revertir todo. No toca triggers ni protecciones.
-- Cubre: primitivas internas (catálogo y creación), constraints, atomicidad, auditoría, independencia del catálogo
-- oficial y permisos (anon / authenticated / service_role). La capa HTTP se prueba en
-- supabase/functions/workshop-intake/handler.test.ts.
DO $test$
DECLARE
  ed uuid := active_edition_id();
  d_real uuid; d_demo uuid; c_a uuid; c_b uuid; c_off uuid; c_demo uuid;
  v_base jsonb; v_res jsonb; v_cat jsonb; v_id uuid; v_row workshop_submissions%ROWTYPE; v_audit jsonb;
  v_err text; v_n int; v_n2 int; v_snap text; v_snap2 text; v_s1 int; v_c1 int; v_other uuid := gen_random_uuid();
  v_mode text; r record; v_tpl text; v_single uuid; v_mal uuid;
  v_pass int := 0; v_fail int := 0; v_res_str text := '';
BEGIN
  SELECT mode INTO v_mode FROM editions WHERE id = ed;

  -- ===================== FIXTURE =====================
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RWI-REAL', 'RWI División Real', 901, false) RETURNING id INTO d_real;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RWI-DEMO', 'RWI División Demo', 902, true) RETURNING id INTO d_demo;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-A', 'RWI Carrera A', d_real, false, true) RETURNING id INTO c_a;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-B', 'RWI Carrera B', d_real, false, true) RETURNING id INTO c_b;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-OFF', 'RWI Inactiva', d_real, false, false) RETURNING id INTO c_off;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-DEMO', 'RWI Carrera Demo', d_demo, true, true) RETURNING id INTO c_demo;

  v_base := jsonb_build_object(
    'facilitator_name', 'Ana Pérez', 'facilitator_email', 'ana@example.com', 'facilitator_phone', '998 123 4567',
    'division_id', d_real, 'activity_type', 'academica', 'title', 'Código Rojo Cancún 2035',
    'student_pitch', 'Pitch', 'why_join', 'Porque sí', 'objective', 'Objetivo', 'student_experience', 'Experiencia', 'takeaway', 'Aprendizaje',
    'keywords', jsonb_build_array('ciberseguridad', 'ia', 'simulación'),
    'session_duration_minutes', 45, 'capacity_per_session', 30, 'operating_start_time', '10:00', 'operating_end_time', '14:00', 'break_minutes', 10,
    'building', 'Edificio A', 'room_space', 'Por confirmar', 'requirements', NULL, 'notes', NULL,
    'career_ids', jsonb_build_array(c_a, c_b));

  -- ===================== 1. Seguridad: permisos y RLS =====================
  SELECT count(*) INTO v_n FROM pg_class WHERE relname IN ('workshop_submissions', 'workshop_submission_careers') AND relrowsecurity;
  IF v_n = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.rls[' || v_n || '] '; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE tablename IN ('workshop_submissions', 'workshop_submission_careers');
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.noPolicies[' || v_n || '] '; END IF;

  FOREACH v_err IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOR r IN SELECT t, p FROM unnest(ARRAY['workshop_submissions', 'workshop_submission_careers']) t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p LOOP
      IF has_table_privilege(v_err, 'public.' || r.t, r.p) THEN
        v_fail := v_fail + 1; v_res_str := v_res_str || '1.grant[' || v_err || ':' || r.t || ':' || r.p || '] ';
      ELSE v_pass := v_pass + 1; END IF;
    END LOOP;
    FOR r IN SELECT f FROM unnest(ARRAY['create_workshop_submission_internal(jsonb)', 'workshop_intake_catalog_internal()', 'workshop_keywords_valid(text[])', 'workshop_submission_require_career()']) f LOOP
      IF has_function_privilege(v_err, 'public.' || r.f, 'EXECUTE') THEN
        v_fail := v_fail + 1; v_res_str := v_res_str || '1.fnGrant[' || v_err || ':' || r.f || '] ';
      ELSE v_pass := v_pass + 1; END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('service_role', 'public.create_workshop_submission_internal(jsonb)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.workshop_intake_catalog_internal()', 'EXECUTE')
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.serviceExec[] '; END IF;

  -- En ejecución real: anon / authenticated no pueden ni leer ni escribir ni llamar las primitivas
  FOREACH v_err IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', v_err)::text, true);
    PERFORM set_config('role', v_err, true);
    v_s1 := 0;
    BEGIN PERFORM count(*) FROM workshop_submissions; EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN PERFORM count(*) FROM workshop_submission_careers; EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN INSERT INTO workshop_submissions (edition_id) VALUES (ed); EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN UPDATE workshop_submissions SET status = 'published'; EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN DELETE FROM workshop_submissions; EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN TRUNCATE workshop_submissions; EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN PERFORM create_workshop_submission_internal(v_base); EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    BEGIN PERFORM workshop_intake_catalog_internal(); EXCEPTION WHEN insufficient_privilege THEN v_s1 := v_s1 + 1; END;
    PERFORM set_config('role', 'postgres', true); PERFORM set_config('request.jwt.claims', '', true);
    IF v_s1 = 8 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.denied[' || v_err || ':' || v_s1 || '/8] '; END IF;
  END LOOP;

  -- ===================== 2. GET: catálogo mínimo =====================
  PERFORM set_config('role', 'service_role', true);
  v_cat := workshop_intake_catalog_internal();
  PERFORM set_config('role', 'postgres', true);
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_cat) k) = ARRAY['careers', 'divisions', 'edition'] THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.catKeys[' || v_cat::text || '] '; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_cat->'edition') k) = ARRAY['event_date', 'name'] THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.editionKeys[] '; END IF;
  IF (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) = ARRAY['career_id', 'career_name', 'division_id']) FROM jsonb_array_elements(v_cat->'careers') x) THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.careerKeys[] '; END IF;
  IF (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) = ARRAY['division_id', 'division_name']) FROM jsonb_array_elements(v_cat->'divisions') x) THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.divisionKeys[] '; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_a::text AND x->>'division_id' = d_real::text)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_b::text)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_off::text)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'divisions') x WHERE x->>'division_id' = d_real::text)
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.catMembers[] '; END IF;
  IF v_mode = 'preparacion' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_demo::text) THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.prepIncludesDemo[] '; END IF;
  END IF;
  -- en operación real el catálogo público no incluye datos demo
  UPDATE editions SET mode = 'operacion_real' WHERE id = ed;
  PERFORM set_config('role', 'service_role', true);
  v_cat := workshop_intake_catalog_internal();
  PERFORM set_config('role', 'postgres', true);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE (x->>'career_id')::uuid IN (SELECT id FROM careers WHERE is_demo))
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'divisions') x WHERE (x->>'division_id')::uuid IN (SELECT id FROM divisions WHERE is_demo))
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_a::text)
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.realNoDemo[] '; END IF;
  v_err := NULL; BEGIN PERFORM create_workshop_submission_internal(v_base || jsonb_build_object('division_id', d_demo, 'career_ids', jsonb_build_array(c_demo))); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_DIVISION%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.realRejectsDemoDiv[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN PERFORM create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_demo))); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.realRejectsDemoCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  UPDATE editions SET mode = v_mode WHERE id = ed;

  -- ===================== 3. Crear propuesta válida (+ independencia del catálogo oficial) =====================
  SELECT (SELECT count(*) FROM activities) || '/' || (SELECT count(*) FROM activity_sessions) || '/' || (SELECT count(*) FROM activity_careers)
         || '/' || (SELECT count(*) FROM activity_credentials) || '/' || (SELECT count(*) FROM reservations) || '/' || (SELECT count(*) FROM attendances) INTO v_snap;
  SELECT count(*) INTO v_s1 FROM audit_log WHERE action = 'workshop_submission.created';

  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base);
  PERFORM set_config('role', 'postgres', true);
  v_id := (v_res->>'submission_id')::uuid;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_res) k) = ARRAY['status', 'submission_id', 'submitted_at'] AND v_res->>'status' = 'submitted'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.response[' || v_res::text || '] '; END IF;
  SELECT * INTO v_row FROM workshop_submissions WHERE id = v_id;
  IF v_row.status = 'submitted' AND v_row.edition_id = ed AND v_row.submitted_at IS NOT NULL AND v_row.is_demo = false
     AND v_row.reviewed_at IS NULL AND v_row.reviewed_by IS NULL AND v_row.admin_notes IS NULL AND v_row.published_activity_id IS NULL
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.row[' || coalesce(v_row.status, 'null') || '] '; END IF;
  IF v_row.keywords = ARRAY['ciberseguridad', 'ia', 'simulación'] AND v_row.building = 'Edificio A' AND v_row.room_space = 'Por confirmar'
     AND v_row.operating_start_time = '10:00' AND v_row.operating_end_time = '14:00' AND v_row.requirements IS NULL AND v_row.notes IS NULL
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.fields[] '; END IF;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_id AND career_id IN (c_a, c_b);
  IF v_n = 2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.careers[' || v_n || '] '; END IF;
  -- auditoría mínima
  SELECT count(*) INTO v_n FROM audit_log WHERE action = 'workshop_submission.created';
  SELECT detail INTO v_audit FROM audit_log WHERE action = 'workshop_submission.created' AND detail->>'submission_id' = v_id::text;
  IF v_n = v_s1 + 1 AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_audit) k) = ARRAY['edition_id', 'status', 'submission_id']
     AND v_audit::text NOT LIKE '%ana@example.com%' AND v_audit::text NOT LIKE '%Código Rojo%' AND v_audit::text NOT LIKE '%998%'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.audit[' || coalesce(v_audit::text, 'null') || '] '; END IF;
  -- el catálogo oficial no cambia
  SELECT (SELECT count(*) FROM activities) || '/' || (SELECT count(*) FROM activity_sessions) || '/' || (SELECT count(*) FROM activity_careers)
         || '/' || (SELECT count(*) FROM activity_credentials) || '/' || (SELECT count(*) FROM reservations) || '/' || (SELECT count(*) FROM attendances) INTO v_snap2;
  IF v_snap = v_snap2 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.catalogChanged[' || v_snap || ' vs ' || v_snap2 || '] '; END IF;

  -- una sola carrera, teléfono vacío y notas
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a), 'facilitator_phone', '  ', 'notes', 'Necesito extensiones', 'activity_type', 'liderazgo'));
  PERFORM set_config('role', 'postgres', true);
  SELECT * INTO v_row FROM workshop_submissions WHERE id = (v_res->>'submission_id')::uuid;
  v_single := v_row.id;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_row.id;
  IF v_n = 1 AND v_row.facilitator_phone IS NULL AND v_row.notes = 'Necesito extensiones' AND v_row.activity_type = 'liderazgo'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.single[' || v_n || '] '; END IF;

  -- campos maliciosos en el payload: ninguno controla la fila final
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base || jsonb_build_object('status', 'published', 'edition_id', v_other, 'reviewed_by', v_other, 'reviewed_at', now(),
    'published_activity_id', v_other, 'admin_notes', 'aprobado', 'is_demo', true, 'id', v_other, 'submitted_at', '2000-01-01'));
  PERFORM set_config('role', 'postgres', true);
  SELECT * INTO v_row FROM workshop_submissions WHERE id = (v_res->>'submission_id')::uuid;
  v_mal := v_row.id;
  IF v_row.status = 'submitted' AND v_row.edition_id = ed AND v_row.reviewed_by IS NULL AND v_row.reviewed_at IS NULL AND v_row.admin_notes IS NULL
     AND v_row.published_activity_id IS NULL AND v_row.is_demo = false AND v_row.id <> v_other AND v_row.submitted_at > '2020-01-01'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.malicious[' || v_row.status || '] '; END IF;

  -- ===================== 4. Rechazos de negocio sin escrituras parciales =====================
  SELECT count(*) INTO v_s1 FROM workshop_submissions;
  SELECT count(*) INTO v_c1 FROM workshop_submission_careers;
  FOR r IN SELECT * FROM (VALUES
      ('careers_empty',      v_base || '{"career_ids": []}'::jsonb,                                              'CAREERS_REQUIRED'),
      ('careers_dup',        v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_a)),           'DUPLICATE_CAREER'),
      ('career_missing',     v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, v_other)),       'INVALID_CAREER'),
      ('career_inactive',    v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_off)),         'INVALID_CAREER'),
      ('career_not_uuid',    v_base || '{"career_ids": ["abc"]}'::jsonb,                                         'INVALID_CAREER'),
      ('division_missing',   v_base || jsonb_build_object('division_id', v_other),                              'INVALID_DIVISION'),
      ('division_not_uuid',  v_base || '{"division_id": "xyz"}'::jsonb,                                           'INVALID_DIVISION'),
      ('catalog_mismatch',   v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_demo)),        'CATALOG_MISMATCH'),
      ('kw_not_array',       v_base || '{"keywords": "a, b, c"}'::jsonb,                                         'INVALID_PAYLOAD'),
      ('careers_not_array',  v_base || '{"career_ids": "x"}'::jsonb,                                             'INVALID_PAYLOAD'),
      ('kw_two',             v_base || '{"keywords": ["a", "b"]}'::jsonb,                                        'keywords_check'),
      ('type_bad',           v_base || '{"activity_type": "taller"}'::jsonb,                                     'activity_type_check'),
      ('duration_zero',      v_base || '{"session_duration_minutes": 0}'::jsonb,                                 'duration_check'),
      ('capacity_zero',      v_base || '{"capacity_per_session": 0}'::jsonb,                                     'capacity_check'),
      ('break_negative',     v_base || '{"break_minutes": -1}'::jsonb,                                           'break_check'),
      ('hours_inverted',     v_base || '{"operating_start_time": "15:00", "operating_end_time": "10:00"}'::jsonb, 'hours_check'),
      ('email_bad',          v_base || '{"facilitator_email": "sin-arroba"}'::jsonb,                             'email_check'),
      ('title_blank',        v_base || '{"title": "   "}'::jsonb,                                                'text_check'),
      ('payload_array',      '[]'::jsonb,                                                                        'INVALID_PAYLOAD')
    ) AS t(name, payload, expected)
  LOOP
    v_err := NULL;
    BEGIN PERFORM create_workshop_submission_internal(r.payload); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err LIKE '%' || r.expected || '%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.' || r.name || '[' || coalesce(v_err, 'ok') || '] '; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM workshop_submissions; SELECT count(*) INTO v_n2 FROM workshop_submission_careers;
  IF v_n = v_s1 AND v_n2 = v_c1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '4.partialWrites[' || (v_n - v_s1) || '/' || (v_n2 - v_c1) || '] '; END IF;

  -- ===================== 5. Constraints directos (defensa en profundidad) =====================
  v_tpl := $q$INSERT INTO workshop_submissions (edition_id, division_id, status, submitted_at, facilitator_name, facilitator_email, activity_type, title,
      student_pitch, why_join, objective, student_experience, takeaway, keywords, session_duration_minutes, capacity_per_session,
      operating_start_time, operating_end_time, break_minutes, building, room_space)
    VALUES (%1$L, %2$L, %3$s, now(), 'N', %4$s, %5$s, %6$s, 'p', 'w', 'o', 'e', 't', %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, 'B', 'R')$q$;
  FOR r IN SELECT * FROM (VALUES
      ('control_valid',    '{}'::jsonb,                                                   NULL),
      ('status_bogus',     '{"status": "''bogus''"}'::jsonb,                              'status_check'),
      ('status_published_ok', '{"status": "''published''"}'::jsonb,                        NULL),
      ('type_bogus',       '{"type": "''taller''"}'::jsonb,                               'activity_type_check'),
      ('duration_zero',    '{"dur": "0"}'::jsonb,                                         'duration_check'),
      ('duration_neg',     '{"dur": "-3"}'::jsonb,                                        'duration_check'),
      ('capacity_zero',    '{"cap": "0"}'::jsonb,                                         'capacity_check'),
      ('capacity_neg',     '{"cap": "-1"}'::jsonb,                                        'capacity_check'),
      ('break_neg',        '{"brk": "-5"}'::jsonb,                                        'break_check'),
      ('break_zero_ok',    '{"brk": "0"}'::jsonb,                                         NULL),
      ('hours_equal',      '{"st": "''10:00''", "en": "''10:00''"}'::jsonb,               'hours_check'),
      ('hours_inverted',   '{"st": "''12:00''", "en": "''10:00''"}'::jsonb,               'hours_check'),
      ('kw_two',           '{"kw": "ARRAY[''a'',''b'']"}'::jsonb,                         'keywords_check'),
      ('kw_six',           '{"kw": "ARRAY[''a'',''b'',''c'',''d'',''e'',''f'']"}'::jsonb, 'keywords_check'),
      ('kw_five_ok',       '{"kw": "ARRAY[''a'',''b'',''c'',''d'',''e'']"}'::jsonb,       NULL),
      ('kw_empty_el',      '{"kw": "ARRAY[''a'','''',''c'']"}'::jsonb,                    'keywords_check'),
      ('kw_blank_el',      '{"kw": "ARRAY[''a'',''   '',''c'']"}'::jsonb,                 'keywords_check'),
      ('kw_dup_case',      '{"kw": "ARRAY[''a'',''A'',''c'']"}'::jsonb,                   'keywords_check'),
      ('kw_null_el',       '{"kw": "ARRAY[''a'',NULL,''c'']"}'::jsonb,                    'keywords_check'),
      ('kw_too_long',      jsonb_build_object('kw', 'ARRAY[''a'',''b'',''' || repeat('x', 81) || ''']'), 'keywords_check'),
      ('email_no_at',      '{"email": "''sin-arroba''"}'::jsonb,                          'email_check'),
      ('email_space',      '{"email": "''a b@c.com''"}'::jsonb,                           'email_check'),
      ('email_noninst_ok', '{"email": "''persona@gmail.com''"}'::jsonb,                   NULL),
      ('title_blank',      '{"title": "''   ''"}'::jsonb,                                 'text_check'),
      ('title_huge',       jsonb_build_object('title', '''' || repeat('x', 301) || ''''), 'text_check')
    ) AS t(name, o, expected)
  LOOP
    v_err := NULL;
    BEGIN
      EXECUTE format(v_tpl, ed, d_real,
        coalesce(r.o->>'status', '''submitted'''), coalesce(r.o->>'email', '''a@b.co'''), coalesce(r.o->>'type', '''academica'''), coalesce(r.o->>'title', '''Taller'''),
        coalesce(r.o->>'kw', 'ARRAY[''a'',''b'',''c'']'), coalesce(r.o->>'dur', '30'), coalesce(r.o->>'cap', '10'),
        coalesce(r.o->>'st', '''10:00'''), coalesce(r.o->>'en', '''12:00'''), coalesce(r.o->>'brk', '5'));
      RAISE EXCEPTION 'OK_ROLLBACK';  -- un insert válido se revierte para no dejar eventos diferidos pendientes
    EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err = 'OK_ROLLBACK' THEN v_err := NULL; END IF;
    IF (r.expected IS NULL AND v_err IS NULL) OR (r.expected IS NOT NULL AND v_err LIKE '%' || r.expected || '%')
      THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.' || r.name || '[' || coalesce(v_err, 'ok') || '] '; END IF;
  END LOOP;
  -- FKs: edición y división inexistentes
  v_err := NULL; BEGIN EXECUTE format(v_tpl, v_other, d_real, '''submitted''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%foreign key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.fkEdition[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN EXECUTE format(v_tpl, ed, v_other, '''submitted''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%foreign key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.fkDivision[' || coalesce(v_err, 'ok') || '] '; END IF;
  -- relación: duplicado, carrera y propuesta inexistentes
  v_err := NULL; BEGIN INSERT INTO workshop_submission_careers (submission_id, career_id) VALUES (v_id, c_a); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%duplicate key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.dupCareerRow[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN INSERT INTO workshop_submission_careers (submission_id, career_id) VALUES (v_id, v_other); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%foreign key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.fkCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN INSERT INTO workshop_submission_careers (submission_id, career_id) VALUES (v_other, c_a); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%foreign key%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.fkSubmission[' || coalesce(v_err, 'ok') || '] '; END IF;

  -- "al menos una carrera" (constraint diferido, forzado a inmediato para la prueba)
  SET CONSTRAINTS workshop_submissions_require_career IMMEDIATE;
  v_err := NULL; BEGIN EXECUTE format(v_tpl, ed, d_real, '''submitted''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SUBMISSION_REQUIRES_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.requiresCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN EXECUTE format(replace(v_tpl, 'status, submitted_at', 'status, submitted_at'), ed, d_real, '''draft''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.draftNoCareerOk[' || coalesce(v_err, '?') || '] '; END IF;
  SET CONSTRAINTS workshop_submissions_require_career DEFERRED;
  -- no se puede dejar sin carreras una propuesta enviada; sí se puede borrar la propuesta completa (cascade)
  DELETE FROM workshop_submission_careers WHERE submission_id = v_mal AND career_id = c_b;   -- le queda c_a
  SET CONSTRAINTS workshop_submission_careers_require_career IMMEDIATE;
  v_err := NULL; BEGIN DELETE FROM workshop_submission_careers WHERE submission_id = v_single; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SUBMISSION_REQUIRES_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.deleteLastCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_single;
  IF v_n = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.lastCareerKept[' || v_n || '] '; END IF;
  v_err := NULL; BEGIN DELETE FROM workshop_submissions WHERE id = v_single; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_single;
  IF v_err IS NULL AND v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.cascadeDelete[' || coalesce(v_err, 'ok') || '/' || v_n || '] '; END IF;
  SET CONSTRAINTS workshop_submission_careers_require_career DEFERRED;

  -- todos los estados administrativos son válidos (con carreras presentes)
  FOREACH v_err IN ARRAY ARRAY['draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'published', 'archived'] LOOP
    BEGIN UPDATE workshop_submissions SET status = v_err WHERE id = v_mal; v_pass := v_pass + 1;
    EXCEPTION WHEN others THEN v_fail := v_fail + 1; v_res_str := v_res_str || '5.status[' || v_err || '] '; END;
  END LOOP;
  SET CONSTRAINTS workshop_submissions_require_career IMMEDIATE;   -- fuerza la verificación pendiente: debe pasar
  v_pass := v_pass + 1;

  RAISE EXCEPTION E'% ok % fail: %', v_pass, v_fail, coalesce(nullif(v_res_str, ''), '(none)');
END
$test$;
