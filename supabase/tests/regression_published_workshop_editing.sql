-- Run only against a disposable database with the current migrations applied.
-- All fixtures and edits are rolled back, including generated credentials and audit rows.
BEGIN;
DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_edition uuid := (SELECT id FROM public.editions WHERE is_active);
  v_c1 uuid;
  v_c2 uuid;
  v_div1 uuid;
  v_div2 uuid;
  v_payload jsonb;
  v_academic jsonb;
  v_sub uuid;
  v_pending uuid;
  v_attended uuid;
  v_initial_life uuid;
  v_activity uuid;
  v_attended_activity uuid;
  v_initial_life_activity uuid;
  v_session uuid;
  v_other_session uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_session_ids uuid[];
  v_detail jsonb;
  v_error text;
BEGIN
  SELECT c.id, c.division_id INTO v_c1, v_div1 FROM public.careers c
    JOIN public.divisions d ON d.id = c.division_id
    WHERE c.is_active AND NOT c.is_demo AND NOT d.is_demo ORDER BY c.id LIMIT 1;
  SELECT c.id, c.division_id INTO v_c2, v_div2 FROM public.careers c
    JOIN public.divisions d ON d.id = c.division_id
    WHERE c.is_active AND NOT c.is_demo AND NOT d.is_demo AND c.division_id <> v_div1 ORDER BY c.id LIMIT 1;
  IF v_edition IS NULL OR v_c1 IS NULL OR v_c2 IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING'; END IF;
  INSERT INTO auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES(v_actor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'workshop-editor@test.invalid', '{}', '{}', now(), now());
  INSERT INTO public.staff_members(user_id, role, full_name, is_active, is_demo)
    VALUES(v_actor, 'coordinacion', 'Editor SQL local', true, false);
  INSERT INTO public.staff_roles(user_id, role) VALUES(v_actor, 'coordinacion');

  v_academic := jsonb_build_object(
    'facilitator_name','Ana Prueba', 'facilitator_email','ana@test.invalid',
    'activity_type','academica', 'experience_category',null,
    'title','Taller SQL local', 'student_pitch','Descripción inicial para el alumno.',
    'objective','Aprender algo nuevo.', 'takeaway','Una experiencia concreta.',
    'keywords',jsonb_build_array('prueba','taller','experiencia'),
    'session_duration_minutes',30, 'capacity_per_session',20,
    'building','Edificio A', 'room_space','Aula 1',
    'requirements',null, 'notes',null, 'career_ids',jsonb_build_array(v_c1));
  v_payload := v_academic;
  v_sub := (public.create_workshop_submission_internal(v_payload)->>'submission_id')::uuid;
  v_pending := (public.create_workshop_submission_internal(v_payload || jsonb_build_object('title','Pendiente local'))->>'submission_id')::uuid;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_pending, v_payload || jsonb_build_object('title','Pendiente editado'));
  IF (SELECT title FROM public.workshop_submissions WHERE id = v_pending) <> 'Pendiente editado' OR
     (SELECT status FROM public.workshop_submissions WHERE id = v_pending) <> 'submitted' THEN
    RAISE EXCEPTION 'FAIL_PENDING_EDIT';
  END IF;
  BEGIN
    UPDATE public.workshop_submissions SET session_duration_minutes = 15 WHERE id = v_pending;
    RAISE EXCEPTION 'FAIL_ACADEMIC_15_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;

  v_initial_life := (public.create_workshop_submission_internal(v_academic ||
    jsonb_build_object('activity_type','vida_universitaria','experience_category','otra',
      'career_ids',jsonb_build_array(),'session_duration_minutes',15,'title','Vida 15 inicial'))->>'submission_id')::uuid;
  v_initial_life_activity := (public.publish_workshop_submission_internal(v_actor, v_initial_life)->>'activity_id')::uuid;
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_initial_life_activity) <> 8 OR
     EXISTS (SELECT 1 FROM public.activity_sessions WHERE activity_id = v_initial_life_activity AND
       (ends_at - starts_at <> interval '15 minutes' OR
        ends_at > ((SELECT event_date FROM public.editions WHERE id = v_edition) + TIME '12:00') AT TIME ZONE 'America/Cancun')) THEN
    RAISE EXCEPTION 'FAIL_PUBLISH_LIFE_15';
  END IF;

  v_activity := (public.publish_workshop_submission_internal(v_actor, v_sub)->>'activity_id')::uuid;
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 4 THEN
    RAISE EXCEPTION 'FAIL_30_SESSIONS';
  END IF;
  v_payload := v_payload || jsonb_build_object('title','Taller publicado editado',
    'student_pitch','Nueva descripción para el alumno.', 'building','Edificio B', 'room_space','Aula 2',
    'career_ids',jsonb_build_array(v_c1,v_c2));
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT published_activity_id FROM public.workshop_submissions WHERE id = v_sub) <> v_activity OR
     (SELECT title FROM public.activities WHERE id = v_activity) <> 'Taller publicado editado' OR
     (SELECT description FROM public.activities WHERE id = v_activity) <> 'Nueva descripción para el alumno.' OR
     (SELECT location FROM public.activities WHERE id = v_activity) <> 'Edificio B Aula 2' OR
     (SELECT division_id FROM public.activities WHERE id = v_activity) IS NOT NULL OR
     (SELECT count(*) FROM public.workshop_submission_careers WHERE submission_id = v_sub) <> 2 OR
     (SELECT count(*) FROM public.activity_careers WHERE activity_id = v_activity) <> 2 OR
     (SELECT count(*) FROM public.activity_divisions WHERE activity_id = v_activity) <> 2 THEN
    RAISE EXCEPTION 'FAIL_PUBLISHED_PROJECTION';
  END IF;
  SELECT id INTO v_session FROM public.activity_sessions WHERE activity_id = v_activity ORDER BY starts_at LIMIT 1;
  UPDATE public.activity_sessions SET location = 'Aula propia' WHERE id = v_session;
  v_payload := v_payload || jsonb_build_object('building','Edificio C', 'room_space','Aula 3', 'career_ids',jsonb_build_array(v_c2));
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  v_detail := public.workshop_admin_get_internal(v_sub);
  IF (SELECT location FROM public.activity_sessions WHERE id = v_session) <> 'Aula propia' OR
     (SELECT division_id FROM public.activities WHERE id = v_activity) <> v_div2 OR
     (SELECT count(*) FROM public.activity_divisions WHERE activity_id = v_activity) <> 1 OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_detail->'sessions') s WHERE s->>'location' = 'Edificio C Aula 3') THEN
    RAISE EXCEPTION 'FAIL_LOCATION_OR_SINGLE_DIVISION';
  END IF;

  v_payload := v_payload || jsonb_build_object('session_duration_minutes',60);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 2 THEN RAISE EXCEPTION 'FAIL_60_SESSIONS'; END IF;
  SELECT array_agg(id ORDER BY starts_at) INTO v_session_ids FROM public.activity_sessions WHERE activity_id = v_activity;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT array_agg(id ORDER BY starts_at) FROM public.activity_sessions WHERE activity_id = v_activity) <> v_session_ids OR
     (SELECT count(*) FROM public.activity_careers WHERE activity_id = v_activity) <> 1 OR
     (SELECT count(*) FROM public.activity_divisions WHERE activity_id = v_activity) <> 1 THEN
    RAISE EXCEPTION 'FAIL_IDEMPOTENT_RETRY';
  END IF;
  v_payload := v_payload || jsonb_build_object('session_duration_minutes',30);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 4 THEN RAISE EXCEPTION 'FAIL_60_TO_30'; END IF;

  v_payload := v_payload || jsonb_build_object('activity_type','vida_universitaria',
    'experience_category','otra', 'career_ids',jsonb_build_array(), 'session_duration_minutes',15);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  BEGIN
    PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload ||
      jsonb_build_object('activity_type','academica','experience_category',null,'career_ids',jsonb_build_array(v_c1)));
    RAISE EXCEPTION 'FAIL_ACADEMIC_15_RPC_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'INVALID_DURATION' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 8 OR
     (SELECT min(starts_at) FROM public.activity_sessions WHERE activity_id = v_activity) <>
       ((SELECT event_date FROM public.editions WHERE id = v_edition) + TIME '10:00') AT TIME ZONE 'America/Cancun' OR
     (SELECT max(ends_at) FROM public.activity_sessions WHERE activity_id = v_activity) <>
       ((SELECT event_date FROM public.editions WHERE id = v_edition) + TIME '12:00') AT TIME ZONE 'America/Cancun' OR
     EXISTS (SELECT 1 FROM public.activity_sessions WHERE activity_id = v_activity AND ends_at - starts_at <> interval '15 minutes') OR
     (SELECT count(*) FROM public.activity_careers WHERE activity_id = v_activity) <> 0 OR
     (SELECT count(*) FROM public.activity_divisions WHERE activity_id = v_activity) <> 0 OR
     (SELECT division_id FROM public.activities WHERE id = v_activity) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL_LIFE_15_PROJECTION';
  END IF;
  v_payload := v_payload || jsonb_build_object('session_duration_minutes',30);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 4 THEN RAISE EXCEPTION 'FAIL_LIFE_30'; END IF;
  v_payload := v_payload || jsonb_build_object('session_duration_minutes',60);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 2 THEN RAISE EXCEPTION 'FAIL_LIFE_60'; END IF;

  INSERT INTO public.participants(edition_id,email,full_name,origin,is_demo)
    VALUES(v_edition,'published-edit-1@test.invalid','Alumno Uno','manual',false) RETURNING id INTO v_p1;
  INSERT INTO public.participants(edition_id,email,full_name,origin,is_demo)
    VALUES(v_edition,'published-edit-2@test.invalid','Alumno Dos','manual',false) RETURNING id INTO v_p2;
  SELECT id INTO v_session FROM public.activity_sessions WHERE activity_id = v_activity ORDER BY starts_at LIMIT 1;
  INSERT INTO public.reservations(participant_id,session_id,activity_id) VALUES
    (v_p1,v_session,v_activity),(v_p2,v_session,v_activity);
  v_payload := v_payload || jsonb_build_object('capacity_per_session',2);
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload);
  IF (SELECT capacity FROM public.activity_sessions WHERE id = v_session) <> 2 THEN RAISE EXCEPTION 'FAIL_CAPACITY_EQUAL_RESERVED'; END IF;
  BEGIN
    PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload || jsonb_build_object('capacity_per_session',1));
    RAISE EXCEPTION 'FAIL_CAPACITY_BELOW_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'CAPACITY_BELOW_RESERVED' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload || jsonb_build_object('session_duration_minutes',30));
    RAISE EXCEPTION 'FAIL_DURATION_WITH_RESERVATION';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'SESSION_SCHEDULE_LOCKED' THEN RAISE; END IF;
  END;
  IF (SELECT session_duration_minutes FROM public.workshop_submissions WHERE id = v_sub) <> 60 THEN
    RAISE EXCEPTION 'FAIL_ATOMIC_ROLLBACK';
  END IF;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload || jsonb_build_object('title','Editado con reservaciones'));
  IF (SELECT title FROM public.activities WHERE id = v_activity) <> 'Editado con reservaciones' THEN
    RAISE EXCEPTION 'FAIL_OTHER_FIELDS_WITH_RESERVATIONS';
  END IF;
  PERFORM public.workshop_admin_edit_internal(v_actor, v_sub, v_payload ||
    jsonb_build_object('activity_type','academica','experience_category',null,
      'career_ids',jsonb_build_array(v_c1),'title','Académico con reservaciones'));
  IF (SELECT activity_type FROM public.activities WHERE id = v_activity) <> 'academica' OR
     (SELECT count(*) FROM public.activity_sessions WHERE activity_id = v_activity) <> 2 OR
     (SELECT count(*) FROM public.activity_careers WHERE activity_id = v_activity) <> 1 THEN
    RAISE EXCEPTION 'FAIL_TYPE_CHANGE_WITH_SAME_DURATION';
  END IF;

  v_attended := (public.create_workshop_submission_internal(v_academic || jsonb_build_object('title','Taller con asistencia'))->>'submission_id')::uuid;
  v_attended_activity := (public.publish_workshop_submission_internal(v_actor, v_attended)->>'activity_id')::uuid;
  SELECT id INTO v_other_session FROM public.activity_sessions WHERE activity_id = v_attended_activity ORDER BY starts_at LIMIT 1;
  INSERT INTO public.attendances(participant_id,session_id,activity_id)
    VALUES(v_p1,v_other_session,v_attended_activity);
  BEGIN
    PERFORM public.workshop_admin_edit_internal(v_actor, v_attended, v_academic || jsonb_build_object('title','Taller con asistencia','session_duration_minutes',60));
    RAISE EXCEPTION 'FAIL_DURATION_WITH_ATTENDANCE';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'SESSION_SCHEDULE_LOCKED' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.activities WHERE id IN (v_activity,v_attended_activity)) <> 2 OR
     NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'workshop_submission.published_edited' AND
       detail->>'submission_id' = v_sub::text AND detail->>'activity_id' = v_activity::text) THEN
    RAISE EXCEPTION 'FAIL_ACTIVITY_OR_AUDIT';
  END IF;
  RAISE NOTICE 'PUBLISHED_WORKSHOP_EDITING_OK';
END;
$test$;
ROLLBACK;
