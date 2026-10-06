-- Regresión: capa de datos de propuestas de talleres (workshop_submissions). Un solo bloque DO, autocontenido;
-- termina con RAISE EXCEPTION ("N ok M fail: detalle") para revertir todo. No toca triggers ni protecciones.
-- Cubre: primitivas internas (catálogo y creación), constraints, atomicidad, auditoría, independencia del catálogo
-- oficial y permisos (anon / authenticated / service_role). Modelo simplificado: solo nombre y correo del responsable,
-- tipo academica | vida_universitaria, sin división en la entrada, duración 30/60, horario fijo 10:00–12:00 sin descanso,
-- carreras obligatorias solo para académico. La capa HTTP se prueba en
-- supabase/functions/workshop-intake/handler.test.ts.
DO $test$
DECLARE
  ed uuid := active_edition_id();
  d_real uuid; d_real2 uuid; d_demo uuid; c_y uuid; v_vu uuid; c_a uuid; c_b uuid; c_off uuid; c_demo uuid; c_x uuid; v_i int;
  v_base jsonb; v_res jsonb; v_cat jsonb; v_id uuid; v_row workshop_submissions%ROWTYPE; v_audit jsonb;
  v_err text; v_n int; v_n2 int; v_snap text; v_snap2 text; v_s1 int; v_c1 int; v_other uuid := gen_random_uuid();
  v_mode text; r record; v_tpl text; v_single uuid; v_mal uuid;
  v_pass int := 0; v_fail int := 0; v_res_str text := '';
BEGIN
  SELECT mode INTO v_mode FROM editions WHERE id = ed;

  -- ===================== FIXTURE =====================
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RWI-REAL', 'RWI División Real', 901, false) RETURNING id INTO d_real;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RWI-DEMO', 'RWI División Demo', 902, true) RETURNING id INTO d_demo;
  INSERT INTO divisions (code, name, sort_order, is_demo) VALUES ('RWI-REAL2', 'RWI División Real 2', 903, false) RETURNING id INTO d_real2;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-A', 'RWI Carrera A', d_real, false, true) RETURNING id INTO c_a;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-B', 'RWI Carrera B', d_real, false, true) RETURNING id INTO c_b;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-Y', 'RWI Carrera Y (otra división)', d_real2, false, true) RETURNING id INTO c_y;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-OFF', 'RWI Inactiva', d_real, false, false) RETURNING id INTO c_off;
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-DEMO', 'RWI Carrera Demo', d_demo, true, true) RETURNING id INTO c_demo;
  -- carrera no demo colgada de una división demo: tampoco debe ofrecerse ni aceptarse
  INSERT INTO careers (code, name, division_id, is_demo, is_active) VALUES ('RWI-XDIV', 'RWI Carrera en División Demo', d_demo, false, true) RETURNING id INTO c_x;

  v_base := jsonb_build_object(
    'facilitator_name', 'Ana Pérez', 'facilitator_email', 'ana@example.com',
    'activity_type', 'academica', 'title', 'Código Rojo Cancún 2035',
    'student_pitch', 'Pitch', 'objective', 'Objetivo', 'takeaway', 'Aprendizaje',
    'keywords', jsonb_build_array('ciberseguridad', 'ia', 'simulación'),
    'session_duration_minutes', 60, 'capacity_per_session', 30,
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
    FOR r IN SELECT f FROM unnest(ARRAY['create_workshop_submission_internal(jsonb)', 'workshop_intake_catalog_internal()', 'workshop_keywords_valid(text[])', 'workshop_submission_require_career()', 'workshop_submissions_set_updated_at()', 'workshop_fold_keyword(text)']) f LOOP
      IF has_function_privilege(v_err, 'public.' || r.f, 'EXECUTE') THEN
        v_fail := v_fail + 1; v_res_str := v_res_str || '1.fnGrant[' || v_err || ':' || r.f || '] ';
      ELSE v_pass := v_pass + 1; END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('service_role', 'public.create_workshop_submission_internal(jsonb)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.workshop_intake_catalog_internal()', 'EXECUTE')
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.serviceExec[] '; END IF;

  -- 9A: ninguna función del intake conserva EXECUTE heredado de PUBLIC (incluye el trigger helper)
  SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE p.proname IN ('create_workshop_submission_internal', 'workshop_intake_catalog_internal', 'workshop_keywords_valid',
                      'workshop_submission_require_career', 'workshop_submissions_set_updated_at', 'workshop_fold_keyword')
    AND a.grantee = 0;
  IF v_n = 0 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '1.publicExecute[' || v_n || '] '; END IF;

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
  -- el catálogo sigue agrupando carreras de varias divisiones reales
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_y::text AND x->>'division_id' = d_real2::text)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'divisions') x WHERE x->>'division_id' = d_real2::text)
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.catMultiDivision[] '; END IF;
  -- 9A: el catálogo público es SOLO real, sin importar el modo de la edición
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE (x->>'career_id')::uuid IN (SELECT id FROM careers WHERE is_demo OR division_id IN (SELECT id FROM divisions WHERE is_demo)))
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'divisions') x WHERE (x->>'division_id')::uuid IN (SELECT id FROM divisions WHERE is_demo))
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.noDemo[' || v_mode || '] '; END IF;
  FOR v_i IN 1..2 LOOP
    v_err := NULL; BEGIN PERFORM create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_demo))); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.rejectsOnlyDemoCareer' || v_i || '[' || coalesce(v_err, 'ok') || '] '; END IF;
    v_err := NULL; BEGIN PERFORM create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_demo))); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.rejectsDemoCareer' || v_i || '[' || coalesce(v_err, 'ok') || '] '; END IF;
    v_err := NULL; BEGIN PERFORM create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_x))); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err LIKE '%INVALID_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.rejectsCareerInDemoDiv' || v_i || '[' || coalesce(v_err, 'ok') || '] '; END IF;
    IF v_i = 1 THEN
      -- repetir en el otro modo de la edición: el resultado es el mismo
      UPDATE editions SET mode = CASE WHEN v_mode = 'preparacion' THEN 'operacion_real' ELSE 'preparacion' END WHERE id = ed;
      PERFORM set_config('role', 'service_role', true);
      v_cat := workshop_intake_catalog_internal();
      PERFORM set_config('role', 'postgres', true);
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE (x->>'career_id')::uuid IN (SELECT id FROM careers WHERE is_demo OR division_id IN (SELECT id FROM divisions WHERE is_demo)))
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'divisions') x WHERE (x->>'division_id')::uuid IN (SELECT id FROM divisions WHERE is_demo))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_cat->'careers') x WHERE x->>'career_id' = c_a::text)
        THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '2.noDemoOtherMode[] '; END IF;
    END IF;
  END LOOP;
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
     AND v_row.requirements IS NULL AND v_row.notes IS NULL AND v_row.session_duration_minutes = 60
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.fields[] '; END IF;
  -- modelo simplificado: horario y descanso los fija el servidor; sin teléfono ni división
  IF v_row.operating_start_time = '10:00' AND v_row.operating_end_time = '12:00' AND v_row.break_minutes = 0
     AND v_row.facilitator_phone IS NULL AND v_row.division_id IS NULL AND v_row.activity_type = 'academica'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.fixedSchedule[' || v_row.operating_start_time || '-' || v_row.operating_end_time || '/' || v_row.break_minutes || '] '; END IF;
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

  -- una sola carrera, duración de 30 minutos y notas
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a), 'notes', 'Necesito extensiones', 'session_duration_minutes', 30));
  PERFORM set_config('role', 'postgres', true);
  SELECT * INTO v_row FROM workshop_submissions WHERE id = (v_res->>'submission_id')::uuid;
  v_single := v_row.id;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_row.id;
  IF v_n = 1 AND v_row.notes = 'Necesito extensiones' AND v_row.activity_type = 'academica' AND v_row.session_duration_minutes = 30
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.single[' || v_n || '] '; END IF;

  -- académico multidisciplinario: carreras de divisiones distintas, sin división en la propuesta
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_b, c_y)));
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*), count(DISTINCT c.division_id) INTO v_n, v_n2 FROM workshop_submission_careers sc JOIN careers c ON c.id = sc.career_id WHERE sc.submission_id = (v_res->>'submission_id')::uuid;
  SELECT * INTO v_row FROM workshop_submissions WHERE id = (v_res->>'submission_id')::uuid;
  IF v_n = 3 AND v_n2 = 2 AND v_row.division_id IS NULL AND v_row.activity_type = 'academica'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.multiDivision[' || v_n || '/' || v_n2 || '] '; END IF;

  -- Vida Universitaria: cero carreras permitido, con el tipo correcto y el mismo horario fijo
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base || jsonb_build_object('activity_type', 'vida_universitaria', 'experience_category', 'liderazgo', 'objective', NULL, 'career_ids', '[]'::jsonb, 'session_duration_minutes', 30));
  PERFORM set_config('role', 'postgres', true);
  v_vu := (v_res->>'submission_id')::uuid;
  SELECT * INTO v_row FROM workshop_submissions WHERE id = v_vu;
  SELECT count(*) INTO v_n FROM workshop_submission_careers WHERE submission_id = v_vu;
  -- categoría de experiencia y objetivo opcional (NULL, sin texto por defecto)
  IF v_row.experience_category = 'liderazgo' AND v_row.objective IS NULL
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.vidaCategoryObjective[' || coalesce(v_row.experience_category, 'null') || '/' || coalesce(v_row.objective, 'null') || '] '; END IF;
  FOREACH v_err IN ARRAY ARRAY['liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra'] LOOP
    PERFORM set_config('role', 'service_role', true);
    v_res := create_workshop_submission_internal(v_base || jsonb_build_object('activity_type', 'vida_universitaria', 'experience_category', v_err, 'objective', 'Integración', 'career_ids', '[]'::jsonb));
    PERFORM set_config('role', 'postgres', true);
    SELECT * INTO v_row FROM workshop_submissions WHERE id = (v_res->>'submission_id')::uuid;
    IF v_row.experience_category = v_err AND v_row.objective = 'Integración' AND v_row.activity_type = 'vida_universitaria'
      THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.category.' || v_err || '[] '; END IF;
  END LOOP;
  -- el académico guarda categoría NULL
  SELECT count(*) INTO v_n2 FROM workshop_submissions WHERE id = v_id AND experience_category IS NULL AND activity_type = 'academica' AND objective IS NOT NULL;
  IF v_n2 = 1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.academicNullCategory[] '; END IF;
  SELECT * INTO v_row FROM workshop_submissions WHERE id = v_vu;
  IF v_n = 0 AND v_row.activity_type = 'vida_universitaria' AND v_row.status = 'submitted' AND v_row.division_id IS NULL
     AND v_row.operating_start_time = '10:00' AND v_row.operating_end_time = '12:00' AND v_row.break_minutes = 0
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.vidaUniversitaria[' || v_n || '/' || coalesce(v_row.activity_type, 'null') || '] '; END IF;

  -- propuesta de referencia para las pruebas de constraints (dos carreras)
  PERFORM set_config('role', 'service_role', true);
  v_res := create_workshop_submission_internal(v_base);
  PERFORM set_config('role', 'postgres', true);
  v_mal := (v_res->>'submission_id')::uuid;

  -- claves fuera de la lista blanca (administrativas o retiradas del formulario): la función rechaza todo el payload
  SELECT count(*) INTO v_s1 FROM workshop_submissions;
  FOR r IN SELECT * FROM (VALUES
      ('status', '{"status": "published"}'), ('edition_id', jsonb_build_object('edition_id', v_other)), ('reviewed_by', jsonb_build_object('reviewed_by', v_other)),
      ('reviewed_at', '{"reviewed_at": "2026-01-01"}'), ('published_activity_id', jsonb_build_object('published_activity_id', v_other)),
      ('admin_notes', '{"admin_notes": "aprobado"}'), ('is_demo', '{"is_demo": true}'), ('id', jsonb_build_object('id', v_other)),
      ('submitted_at', '{"submitted_at": "2000-01-01"}'),
      ('phone', '{"facilitator_phone": "998 123 4567"}'), ('division', jsonb_build_object('division_id', d_real)),
      ('start', '{"operating_start_time": "08:00"}'), ('end', '{"operating_end_time": "20:00"}'), ('break', '{"break_minutes": 15}')
    ) AS t(name, extra)
  LOOP
    v_err := NULL;
    BEGIN PERFORM create_workshop_submission_internal(v_base || r.extra::jsonb); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF v_err LIKE '%INVALID_PAYLOAD%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.extraKey.' || r.name || '[' || coalesce(v_err, 'ok') || '] '; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM workshop_submissions;
  IF v_n = v_s1 THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.extraKeyWrites[' || (v_n - v_s1) || '] '; END IF;
  SELECT * INTO v_row FROM workshop_submissions WHERE id = v_mal;
  IF v_row.status = 'submitted' AND v_row.edition_id = ed AND v_row.reviewed_by IS NULL AND v_row.reviewed_at IS NULL AND v_row.admin_notes IS NULL
     AND v_row.published_activity_id IS NULL AND v_row.is_demo = false AND v_row.submitted_at > '2020-01-01'
    THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '3.serverOwnedFields[' || v_row.status || '] '; END IF;

  -- ===================== 4. Rechazos de negocio sin escrituras parciales =====================
  SELECT count(*) INTO v_s1 FROM workshop_submissions;
  SELECT count(*) INTO v_c1 FROM workshop_submission_careers;
  FOR r IN SELECT * FROM (VALUES
      ('careers_empty',      v_base || '{"career_ids": []}'::jsonb,                                              'CAREERS_REQUIRED'),
      ('careers_dup',        v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_a)),           'DUPLICATE_CAREER'),
      ('career_missing',     v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, v_other)),       'INVALID_CAREER'),
      ('vida_careers_dup',   v_base || jsonb_build_object('activity_type', 'vida_universitaria', 'experience_category', 'otra', 'career_ids', jsonb_build_array(c_a, c_a)), 'DUPLICATE_CAREER'),
      ('vida_career_demo',   v_base || jsonb_build_object('activity_type', 'vida_universitaria', 'experience_category', 'otra', 'career_ids', jsonb_build_array(c_demo)),   'INVALID_CAREER'),
      ('academic_with_category', v_base || '{"experience_category": "deportiva"}'::jsonb,                          'INVALID_PAYLOAD'),
      ('vida_without_category',  v_base || '{"activity_type": "vida_universitaria", "career_ids": []}'::jsonb,     'INVALID_PAYLOAD'),
      ('vida_null_category',     v_base || '{"activity_type": "vida_universitaria", "experience_category": null, "career_ids": []}'::jsonb, 'INVALID_PAYLOAD'),
      ('vida_unknown_category',  v_base || '{"activity_type": "vida_universitaria", "experience_category": "musical", "career_ids": []}'::jsonb, 'INVALID_PAYLOAD'),
      ('objective_missing_academic', v_base - 'objective',                                                         'objective_required_check'),
      ('objective_blank_academic',   v_base || '{"objective": "   "}'::jsonb,                                      'objective_required_check'),
      ('career_inactive',    v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_off)),         'INVALID_CAREER'),
      ('career_not_uuid',    v_base || '{"career_ids": ["abc"]}'::jsonb,                                         'INVALID_CAREER'),
      ('demo_career_mixed',  v_base || jsonb_build_object('career_ids', jsonb_build_array(c_a, c_demo)),        'INVALID_CAREER'),
      ('career_in_demo_div', v_base || jsonb_build_object('career_ids', jsonb_build_array(c_x)),                'INVALID_CAREER'),
      ('kw_dup_accent',      v_base || '{"keywords": ["Simulación", "simulacion", "x"]}'::jsonb,                'keywords_check'),
      ('kw_dup_enye',        v_base || '{"keywords": ["Año", "ANO", "x"]}'::jsonb,                              'keywords_check'),
      ('kw_dup_spaces',      v_base || '{"keywords": ["IA  generativa", "ia generativa", "x"]}'::jsonb,         'keywords_check'),
      ('kw_not_array',       v_base || '{"keywords": "a, b, c"}'::jsonb,                                         'INVALID_PAYLOAD'),
      ('careers_not_array',  v_base || '{"career_ids": "x"}'::jsonb,                                             'INVALID_PAYLOAD'),
      ('kw_two',             v_base || '{"keywords": ["a", "b"]}'::jsonb,                                        'keywords_check'),
      ('type_bad',           v_base || '{"activity_type": "taller"}'::jsonb,                                     'INVALID_PAYLOAD'),
      ('type_liderazgo_old', v_base || '{"activity_type": "liderazgo"}'::jsonb,                                  'INVALID_PAYLOAD'),
      ('type_missing',       v_base - 'activity_type',                                                           'INVALID_PAYLOAD'),
      ('duration_zero',      v_base || '{"session_duration_minutes": 0}'::jsonb,                                 'duration_check'),
      ('duration_45',        v_base || '{"session_duration_minutes": 45}'::jsonb,                                'duration_check'),
      ('duration_90',        v_base || '{"session_duration_minutes": 90}'::jsonb,                                'duration_check'),
      ('duration_15',        v_base || '{"session_duration_minutes": 15}'::jsonb,                                'duration_check'),
      ('capacity_zero',      v_base || '{"capacity_per_session": 0}'::jsonb,                                     'capacity_check'),
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
  -- experience_category se deriva del tipo (Vida Universitaria → 'otra'; académico → NULL) para no alterar los 12 argumentos
  v_tpl := $q$INSERT INTO workshop_submissions (edition_id, division_id, status, submitted_at, facilitator_name, facilitator_email, activity_type, title,
      student_pitch,objective,takeaway, keywords, session_duration_minutes, capacity_per_session,
      operating_start_time, operating_end_time, break_minutes, building, room_space, experience_category)
    VALUES (%1$L, %2$L, %3$s, now(), 'N', %4$s, %5$s, %6$s, 'p', 'w', 'o', 'e', 't', %7$s, %8$s, %9$s, %10$s, %11$s, %12$s, 'B', 'R',
      (CASE WHEN %5$s = 'vida_universitaria' THEN 'otra' END))$q$;
  FOR r IN SELECT * FROM (VALUES
      ('control_valid',    '{}'::jsonb,                                                   NULL),
      ('status_bogus',     '{"status": "''bogus''"}'::jsonb,                              'status_check'),
      ('status_published_ok', '{"status": "''published''"}'::jsonb,                        NULL),
      ('type_bogus',       '{"type": "''taller''"}'::jsonb,                               'activity_type_check'),
      ('type_liderazgo_old', '{"type": "''liderazgo''"}'::jsonb,                           'activity_type_check'),
      ('type_vida_ok',     '{"type": "''vida_universitaria''"}'::jsonb,                   NULL),
      ('duration_zero',    '{"dur": "0"}'::jsonb,                                         'duration_check'),
      ('duration_neg',     '{"dur": "-3"}'::jsonb,                                        'duration_check'),
      ('duration_45',      '{"dur": "45"}'::jsonb,                                        'duration_check'),
      ('duration_120',     '{"dur": "120"}'::jsonb,                                       'duration_check'),
      ('duration_30_ok',   '{"dur": "30"}'::jsonb,                                        NULL),
      ('duration_60_ok',   '{"dur": "60"}'::jsonb,                                        NULL),
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
      ('kw_dup_accent',    '{"kw": "ARRAY[''Simulación'',''simulacion'',''c'']"}'::jsonb, 'keywords_check'),
      ('kw_dup_enye',      '{"kw": "ARRAY[''Año'',''ano'',''c'']"}'::jsonb,               'keywords_check'),
      ('kw_accent_distinct_ok', '{"kw": "ARRAY[''Simulación'',''Simulaciones'',''c'']"}'::jsonb, NULL),
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
  -- division_id opcional (la define la revisión): una propuesta sin división es válida; con división inexistente, no
  v_err := NULL; BEGIN EXECUTE format(replace(v_tpl, '%2$L', 'NULL'), ed, d_real, '''draft''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.nullDivisionOk[' || coalesce(v_err, '?') || '] '; END IF;
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
  -- Vida Universitaria sin carreras es válido incluso con el constraint inmediato
  v_err := NULL; BEGIN EXECUTE format(v_tpl, ed, d_real, '''submitted''', '''a@b.co''', '''vida_universitaria''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.vidaNoCareerOk[' || coalesce(v_err, '?') || '] '; END IF;
  -- cambiar una propuesta de Vida Universitaria sin carreras a académica exige carreras
  v_err := NULL; BEGIN UPDATE workshop_submissions SET activity_type = 'academica', experience_category = NULL, objective = 'Objetivo' WHERE id = v_vu; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err LIKE '%SUBMISSION_REQUIRES_CAREER%' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.vidaToAcademicNoCareer[' || coalesce(v_err, 'ok') || '] '; END IF;
  v_err := NULL; BEGIN EXECUTE format(v_tpl, ed, d_real, '''draft''', '''a@b.co''', '''academica''', '''T''', 'ARRAY[''a'',''b'',''c'']', '30', '10', '''10:00''', '''12:00''', '5'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
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

  -- constraints directos de categoría y objetivo
  FOR r IN SELECT * FROM (VALUES
      ('cat_on_academic',     format('UPDATE workshop_submissions SET experience_category = %L WHERE id = %L', 'deportiva', v_mal),  'experience_category_check'),
      ('academic_to_vida_nocat', format('UPDATE workshop_submissions SET activity_type = %L WHERE id = %L', 'vida_universitaria', v_mal), 'experience_category_check'),
      ('vida_null_cat',       format('UPDATE workshop_submissions SET experience_category = NULL WHERE id = %L', v_vu),             'experience_category_check'),
      ('vida_unknown_cat',    format('UPDATE workshop_submissions SET experience_category = %L WHERE id = %L', 'musical', v_vu),    'experience_category_check'),
      ('vida_old_value',      format('UPDATE workshop_submissions SET experience_category = %L WHERE id = %L', 'Liderazgo', v_vu),  'experience_category_check'),
      ('academic_null_objective', format('UPDATE workshop_submissions SET objective = NULL WHERE id = %L', v_mal),                'objective_required_check'),
      ('academic_blank_objective', format('UPDATE workshop_submissions SET objective = %L WHERE id = %L', '  ', v_mal),             'text_check'),
      ('vida_null_objective_ok', format('UPDATE workshop_submissions SET objective = NULL, activity_type = %L, experience_category = %L WHERE id = %L', 'vida_universitaria', 'otra', v_vu), NULL),
      ('vida_other_cat_ok',   format('UPDATE workshop_submissions SET experience_category = %L WHERE id = %L', 'otra', v_vu),       NULL)
    ) AS t(name, stmt, expected)
  LOOP
    v_err := NULL;
    BEGIN EXECUTE r.stmt; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
    IF (r.expected IS NULL AND v_err IS NULL) OR (r.expected IS NOT NULL AND v_err LIKE '%' || r.expected || '%')
      THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_res_str := v_res_str || '5.' || r.name || '[' || coalesce(v_err, 'ok') || '] '; END IF;
  END LOOP;

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
