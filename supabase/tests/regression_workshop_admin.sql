-- Prueba dirigida en la base oficial. Todo se revierte; no deja propuesta, rol ni audit logs de prueba.
BEGIN;
DO $test$
DECLARE
  v_actor uuid;
  v_email text;
  v_id uuid;
  v_careers uuid[];
  v_result jsonb;
  v_edition uuid;
  v_initial_activities bigint;
  v_initial_sessions bigint;
  v_initial_credentials bigint;
  v_audit_count bigint;
BEGIN
  SELECT id, email INTO v_actor, v_email FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_AUTH_USER'; END IF;
  IF EXISTS (SELECT 1 FROM staff_members WHERE user_id = v_actor) THEN RAISE EXCEPTION 'TEST_ACTOR_ALREADY_STAFF'; END IF;
  BEGIN
    PERFORM workshop_review_transition_internal(v_actor, gen_random_uuid(), 'start_review');
    RAISE EXCEPTION 'NON_STAFF_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  INSERT INTO staff_members (user_id, role, full_name, email, is_active, is_demo)
  VALUES (v_actor, 'staff', 'Coordinación temporal 9C', v_email, true, true);
  INSERT INTO staff_roles (user_id, role) VALUES (v_actor, 'staff');
  BEGIN
    PERFORM workshop_review_transition_internal(v_actor, gen_random_uuid(), 'start_review');
    RAISE EXCEPTION 'STAFF_WITHOUT_COORD_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  UPDATE staff_members SET role = 'coordinacion' WHERE user_id = v_actor;
  INSERT INTO staff_roles (user_id, role) VALUES (v_actor, 'coordinacion');
  SELECT id INTO v_edition FROM editions WHERE is_active LIMIT 1;
  SELECT ARRAY(SELECT id FROM careers WHERE is_active AND NOT is_demo ORDER BY name LIMIT 2) INTO v_careers;
  IF cardinality(v_careers) <> 2 THEN RAISE EXCEPTION 'TEST_REQUIRES_CAREERS'; END IF;
  SELECT count(*) INTO v_initial_activities FROM activities;
  SELECT count(*) INTO v_initial_sessions FROM activity_sessions;
  SELECT count(*) INTO v_initial_credentials FROM activity_credentials;

  v_result := create_workshop_submission_internal(jsonb_build_object(
    'facilitator_name', 'Prueba Fase 9C', 'facilitator_email', 'fase9c@example.invalid',
    'activity_type', 'academica', 'title', 'ZZ-FASE-9C-REGRESION',
    'student_pitch', 'Propuesta temporal de prueba para revisión administrativa.',
    'objective', 'Verificar transiciones y auditoría.',
    'takeaway', 'Resultado de prueba.', 'keywords', jsonb_build_array('uno', 'dos', 'tres'),
    'session_duration_minutes', 30, 'capacity_per_session', 20,
    'building', 'Edificio A', 'room_space', 'Salón 1',
    'career_ids', to_jsonb(v_careers)));
  v_id := (v_result->>'submission_id')::uuid;

  v_result := workshop_admin_list_internal('submitted', 'academica', 'ZZ-FASE-9C', 1);
  IF (v_result->>'total')::int <> 1 OR jsonb_array_length(v_result->'items') <> 1 THEN
    RAISE EXCEPTION 'LIST_FAILED'; END IF;
  IF (workshop_admin_list_internal(NULL, NULL, 'fase9c@example.invalid', 1)->>'total')::int <> 1 THEN
    RAISE EXCEPTION 'EMAIL_SEARCH_FAILED'; END IF;
  IF (workshop_admin_list_internal(NULL, 'vida_universitaria', 'ZZ-FASE-9C', 1)->>'total')::int <> 0 THEN
    RAISE EXCEPTION 'TYPE_FILTER_FAILED'; END IF;
  IF workshop_admin_get_internal(gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'GET_NOT_FOUND_FAILED'; END IF;
  v_result := workshop_admin_get_internal(v_id);
  IF jsonb_array_length(v_result->'careers') <> 2 THEN RAISE EXCEPTION 'GET_CAREERS_FAILED'; END IF;

  v_result := workshop_review_transition_internal(v_actor, v_id, 'start_review');
  IF v_result->>'status' <> 'in_review' OR (v_result->>'reviewed_by')::uuid <> v_actor
    OR v_result->>'reviewed_at' IS NULL THEN RAISE EXCEPTION 'START_REVIEW_FAILED'; END IF;
  BEGIN
    PERFORM workshop_review_transition_internal(v_actor, v_id, 'start_review');
    RAISE EXCEPTION 'INVALID_TRANSITION_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INVALID_TRANSITION' THEN RAISE; END IF;
  END;

  v_result := workshop_review_transition_internal(v_actor, v_id, 'save_notes', 'Revisar capacidad internamente.');
  IF v_result->>'status' <> 'in_review' OR v_result->>'admin_notes' <> 'Revisar capacidad internamente.' THEN
    RAISE EXCEPTION 'SAVE_NOTES_FAILED'; END IF;
  BEGIN
    PERFORM workshop_review_transition_internal(v_actor, v_id, 'request_changes', NULL, '  ');
    RAISE EXCEPTION 'EMPTY_FEEDBACK_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FEEDBACK_REQUIRED' THEN RAISE; END IF;
  END;
  v_result := workshop_review_transition_internal(v_actor, v_id, 'request_changes', NULL, 'Especifica los materiales.');
  IF v_result->>'status' <> 'changes_requested' OR v_result->>'review_feedback' <> 'Especifica los materiales.' THEN
    RAISE EXCEPTION 'REQUEST_CHANGES_FAILED'; END IF;
  v_result := workshop_review_transition_internal(v_actor, v_id, 'resume_review');
  IF v_result->>'status' <> 'in_review' THEN RAISE EXCEPTION 'RESUME_FAILED'; END IF;
  v_result := workshop_review_transition_internal(v_actor, v_id, 'archive');
  IF v_result->>'status' <> 'archived' THEN RAISE EXCEPTION 'ARCHIVE_FAILED'; END IF;

  SELECT count(*) INTO v_audit_count FROM audit_log
  WHERE edition_id = v_edition AND actor_user_id = v_actor
    AND detail->>'submission_id' = v_id::text
    AND action IN ('workshop_submission.review_started', 'workshop_submission.notes_updated',
      'workshop_submission.changes_requested', 'workshop_submission.review_resumed', 'workshop_submission.archived');
  IF v_audit_count <> 5 THEN RAISE EXCEPTION 'AUDIT_COUNT_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM audit_log WHERE detail->>'submission_id' = v_id::text
    AND (detail::text ILIKE '%fase9c@example.invalid%' OR detail::text ILIKE '%materiales%'
      OR detail::text ILIKE '%capacidad%')) THEN RAISE EXCEPTION 'AUDIT_PII_FAILED'; END IF;
  IF (SELECT count(*) FROM activities) <> v_initial_activities
    OR (SELECT count(*) FROM activity_sessions) <> v_initial_sessions
    OR (SELECT count(*) FROM activity_credentials) <> v_initial_credentials THEN
    RAISE EXCEPTION 'CATALOG_SIDE_EFFECT'; END IF;
END
$test$;
ROLLBACK;
SELECT 'workshop_admin_regression_ok' AS result;
