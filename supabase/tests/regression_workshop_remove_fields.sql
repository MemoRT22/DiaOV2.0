-- Verificación de la migración 20261006034500 (retiro de why_join / student_experience).
-- Ejecutar DESPUÉS de aplicar las migraciones del PR en un entorno de prueba, o dentro de una transacción que se revierta.
-- Termina siempre con RAISE EXCEPTION 'REMOVE_FIELDS_OK ...' para no dejar filas de prueba.
DO $test$
DECLARE
  v_careers uuid[]; v_res jsonb; v_err text; v_n int; v_def text;
  v_base jsonb;
BEGIN
  -- columnas retiradas
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'workshop_submissions' AND column_name IN ('why_join', 'student_experience');
  IF v_n <> 0 THEN RAISE EXCEPTION 'COLUMNS_STILL_EXIST[%]', v_n; END IF;

  -- objective nullable; una sola regla de objetivo obligatorio para académico
  IF (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workshop_submissions' AND column_name = 'objective') <> 'YES' THEN
    RAISE EXCEPTION 'OBJECTIVE_NOT_NULLABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.workshop_submissions'::regclass AND conname = 'workshop_submissions_objective_required_check') THEN
    RAISE EXCEPTION 'OBJECTIVE_REQUIRED_CHECK_MISSING'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.workshop_submissions'::regclass AND conname = 'workshop_submissions_objective_check') THEN
    RAISE EXCEPTION 'OBJECTIVE_REDUNDANT_CHECK_EXISTS'; END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
  WHERE conrelid = 'public.workshop_submissions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%academica%' AND pg_get_constraintdef(oid) LIKE '%objective IS NOT NULL%';
  IF v_n <> 1 THEN RAISE EXCEPTION 'OBJECTIVE_RULE_COUNT[%]', v_n; END IF;

  -- text_check conserva el resto de validaciones y ya no menciona las columnas retiradas
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conrelid = 'public.workshop_submissions'::regclass AND conname = 'workshop_submissions_text_check';
  IF v_def IS NULL OR v_def LIKE '%why_join%' OR v_def LIKE '%student_experience%' THEN RAISE EXCEPTION 'TEXT_CHECK_BAD'; END IF;
  FOR v_err IN SELECT unnest(ARRAY['facilitator_name', 'facilitator_phone', 'title', 'student_pitch', 'objective', 'takeaway', 'building', 'room_space', 'requirements', 'notes', 'admin_notes']) LOOP
    IF v_def NOT LIKE '%' || v_err || '%' THEN RAISE EXCEPTION 'TEXT_CHECK_LOST[%]', v_err; END IF;
  END LOOP;

  SELECT array_agg(id) INTO v_careers FROM (SELECT id FROM public.careers WHERE is_active AND NOT is_demo ORDER BY name LIMIT 2) x;
  IF coalesce(cardinality(v_careers), 0) <> 2 THEN RAISE EXCEPTION 'TEST_REQUIRES_REAL_CAREERS'; END IF;

  v_base := jsonb_build_object(
    'facilitator_name', 'Prueba Remove Fields', 'facilitator_email', 'remove@test.invalid',
    'activity_type', 'academica', 'title', 'ZZ-REMOVE-FIELDS', 'student_pitch', 'Pitch',
    'objective', 'Objetivo', 'takeaway', 'Take', 'keywords', jsonb_build_array('uno', 'dos', 'tres'),
    'session_duration_minutes', 30, 'capacity_per_session', 10, 'building', 'Ed', 'room_space', 'Salón',
    'career_ids', to_jsonb(v_careers));

  -- académico sin why_join / student_experience
  v_res := public.create_workshop_submission_internal(v_base);
  IF v_res->>'status' <> 'submitted' THEN RAISE EXCEPTION 'ACADEMIC_CREATE_FAILED'; END IF;

  -- académico sin objetivo: lo rechaza el CHECK
  v_err := NULL; BEGIN PERFORM public.create_workshop_submission_internal(v_base - 'objective'); EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE '%objective_required_check%' THEN RAISE EXCEPTION 'ACADEMIC_NO_OBJECTIVE_ACCEPTED[%]', coalesce(v_err, 'ok'); END IF;

  -- Vida Universitaria con objective = null y sin carreras
  v_res := public.create_workshop_submission_internal(jsonb_build_object(
    'facilitator_name', 'Prueba Remove VU', 'facilitator_email', 'removevu@test.invalid',
    'activity_type', 'vida_universitaria', 'experience_category', 'otra', 'title', 'ZZ-REMOVE-FIELDS-VU', 'student_pitch', 'Pitch',
    'objective', NULL, 'takeaway', 'Take', 'keywords', jsonb_build_array('uno', 'dos', 'tres'),
    'session_duration_minutes', 60, 'capacity_per_session', 10, 'building', 'Ed', 'room_space', 'Salón', 'career_ids', '[]'::jsonb));
  IF (SELECT objective FROM public.workshop_submissions WHERE id = (v_res->>'submission_id')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'VU_OBJECTIVE_NOT_NULL'; END IF;

  -- un cliente antiguo con las claves retiradas es rechazado
  FOREACH v_err IN ARRAY ARRAY['why_join', 'student_experience'] LOOP
    DECLARE v_e2 text := NULL;
    BEGIN
      BEGIN PERFORM public.create_workshop_submission_internal(v_base || jsonb_build_object(v_err, 'texto')); EXCEPTION WHEN others THEN v_e2 := SQLERRM; END;
      IF v_e2 IS DISTINCT FROM 'INVALID_PAYLOAD' THEN RAISE EXCEPTION 'OLD_CLIENT_ACCEPTED[%:%]', v_err, coalesce(v_e2, 'ok'); END IF;
    END;
  END LOOP;

  -- el resto de validaciones de texto siguen vigentes
  v_err := NULL; BEGIN UPDATE public.workshop_submissions SET title = '   ' WHERE title = 'ZZ-REMOVE-FIELDS'; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE '%text_check%' THEN RAISE EXCEPTION 'TEXT_CHECK_TITLE_LOST[%]', coalesce(v_err, 'ok'); END IF;
  v_err := NULL; BEGIN UPDATE public.workshop_submissions SET notes = repeat('x', 3001) WHERE title = 'ZZ-REMOVE-FIELDS'; EXCEPTION WHEN others THEN v_err := SQLERRM; END;
  IF v_err IS NULL OR v_err NOT LIKE '%text_check%' THEN RAISE EXCEPTION 'TEXT_CHECK_NOTES_LOST[%]', coalesce(v_err, 'ok'); END IF;

  -- permisos de la primitiva de publicación (si ya existe en el esquema de prueba)
  IF to_regprocedure('public.publish_workshop_submission_internal(uuid,uuid)') IS NOT NULL THEN
    IF has_function_privilege('anon', 'public.publish_workshop_submission_internal(uuid,uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.publish_workshop_submission_internal(uuid,uuid)', 'EXECUTE')
      OR has_function_privilege('public', 'public.publish_workshop_submission_internal(uuid,uuid)', 'EXECUTE')
      OR NOT has_function_privilege('service_role', 'public.publish_workshop_submission_internal(uuid,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLISH_PERMISSIONS_BAD'; END IF;
  END IF;

  RAISE EXCEPTION 'REMOVE_FIELDS_OK';
END
$test$;
