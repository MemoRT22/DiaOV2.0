-- Current human workflow only. Run after all migrations in a disposable database.
BEGIN;
DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_edition uuid := (SELECT id FROM public.editions WHERE is_active);
  v_career uuid := (SELECT id FROM public.careers WHERE is_active AND NOT is_demo ORDER BY id LIMIT 1);
  v_payload jsonb;
  v_id uuid;
  v_approved uuid;
  v_result jsonb;
  v_activity uuid;
  v_error text;
BEGIN
  IF v_edition IS NULL OR v_career IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING'; END IF;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES(v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'cleanup-admin@test.invalid', '{}', '{}', now(), now());
  INSERT INTO public.staff_members(user_id, role, full_name, is_active, is_demo)
  VALUES(v_actor, 'coordinacion', 'Cleanup Admin', true, false);
  INSERT INTO public.staff_roles(user_id, role) VALUES(v_actor, 'coordinacion');

  v_payload := jsonb_build_object(
    'facilitator_name','Prueba Admin', 'facilitator_email','cleanup@test.invalid',
    'activity_type','academica', 'experience_category',null,
    'title','Cleanup pendiente', 'student_pitch','Una experiencia para el alumno.',
    'objective','Aprender.', 'takeaway','Aprendizaje concreto.',
    'keywords',jsonb_build_array('uno','dos','tres'),
    'session_duration_minutes',30, 'capacity_per_session',20,
    'building','Edificio A', 'room_space','Aula 1',
    'requirements',null, 'notes',null, 'career_ids',jsonb_build_array(v_career));
  v_id := (public.create_workshop_submission_internal(v_payload)->>'submission_id')::uuid;
  IF (public.workshop_admin_list_internal('pending',null,'Cleanup pendiente',1)->>'total')::int <> 1
    OR public.workshop_admin_get_internal(v_id)->>'status' <> 'submitted'
    THEN RAISE EXCEPTION 'PENDING_LIST_OR_GET_FAILED'; END IF;

  PERFORM public.workshop_admin_edit_internal(v_actor,v_id,v_payload || jsonb_build_object('title','Cleanup editado'));
  IF public.workshop_admin_get_internal(v_id)->>'title' <> 'Cleanup editado'
    OR EXISTS(SELECT 1 FROM public.activities WHERE title = 'Cleanup editado')
    THEN RAISE EXCEPTION 'PENDING_EDIT_FAILED'; END IF;

  FOREACH v_error IN ARRAY ARRAY['start_review','save_notes','request_changes','resume_review','approve'] LOOP
    BEGIN
      PERFORM public.workshop_review_transition_internal(v_actor,v_id,v_error);
      RAISE EXCEPTION 'RETIRED_ACTION_ACCEPTED %', v_error;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'INVALID_ACTION' THEN RAISE; END IF;
    END;
  END LOOP;
  v_result := public.workshop_review_transition_internal(v_actor,v_id,'archive');
  IF v_result->>'status' <> 'archived'
    OR (public.workshop_admin_list_internal('archived',null,'Cleanup editado',1)->>'total')::int <> 1
    OR (public.workshop_admin_list_internal('pending',null,'Cleanup editado',1)->>'total')::int <> 0
    OR NOT EXISTS(SELECT 1 FROM public.audit_log WHERE actor_user_id=v_actor
      AND action='workshop_submission.archived' AND detail->>'submission_id'=v_id::text)
    THEN RAISE EXCEPTION 'DISCARD_FAILED'; END IF;

  v_approved := (public.create_workshop_submission_internal(v_payload ||
    jsonb_build_object('title','Cleanup aprobado legacy'))->>'submission_id')::uuid;
  UPDATE public.workshop_submissions SET status='approved' WHERE id=v_approved;
  v_result := public.publish_workshop_submission_internal(v_actor,v_approved);
  v_activity := (v_result->>'activity_id')::uuid;
  IF v_result->>'status' <> 'published' OR
    (public.workshop_admin_list_internal('published',null,'Cleanup aprobado legacy',1)->>'total')::int <> 1 OR
    (SELECT count(*) FROM public.activity_sessions WHERE activity_id=v_activity) <> 4 OR
    (public.workshop_admin_get_internal(v_approved)->>'published_activity_id')::uuid <> v_activity
    THEN RAISE EXCEPTION 'LEGACY_APPROVED_ATOMIC_PUBLISH_FAILED'; END IF;
  IF has_function_privilege('authenticated', 'public.workshop_review_transition_internal(uuid,uuid,text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.workshop_review_transition_internal(uuid,uuid,text,text,text)', 'EXECUTE')
    THEN RAISE EXCEPTION 'TRANSITION_PRIVILEGES_FAILED'; END IF;
END
$test$;
ROLLBACK;
SELECT 'workshop_admin_regression_ok' AS result;
