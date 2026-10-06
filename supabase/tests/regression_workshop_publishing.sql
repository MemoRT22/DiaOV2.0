BEGIN;
DO $test$
DECLARE
  v_actor uuid;
  v_email text;
  v_id uuid;
  v_id_single uuid;
  v_id_vida uuid;
  v_careers uuid[];
  v_careers_single uuid[];
  v_result jsonb;
  v_edition uuid;
  v_act uuid;
  v_act_single uuid;
  v_act_vida uuid;
  v_sess_count int;
  v_audit_count bigint;
  v_token_hash text;
  v_new_token_hash text;
  v_overview jsonb;
  v_pid uuid;
  v_pid_auth uuid;
  v_sess_id uuid;
  v_rec jsonb;
  v_rank int;
  v_tickets jsonb;
  v_sess_start timestamptz;
BEGIN
  -- SETUP ADMIN CONTEXT
  v_actor := gen_random_uuid();
  v_email := 'staff9d@test.invalid';
  INSERT INTO auth.users (id, instance_id, email, role, aud, created_at, updated_at)
  VALUES (v_actor, '00000000-0000-0000-0000-000000000000', v_email, 'authenticated', 'authenticated', now(), now());

  INSERT INTO public.staff_members (user_id, role, full_name, email, is_active, is_demo)
  VALUES (v_actor, 'coordinacion', 'Coord temporal 9D', v_email, true, false)
  ON CONFLICT (user_id) DO UPDATE SET is_active = EXCLUDED.is_active, is_demo = EXCLUDED.is_demo;
  INSERT INTO public.staff_roles (user_id, role) VALUES (v_actor, 'coordinacion') ON CONFLICT DO NOTHING;

  SELECT id INTO v_edition FROM public.editions WHERE is_active LIMIT 1;

  -- Pick 2 careers from DIFFERENT divisions
  SELECT array_agg(id) INTO v_careers FROM (
    SELECT DISTINCT ON (division_id) id
    FROM public.careers WHERE is_active AND NOT is_demo
    ORDER BY division_id, id LIMIT 2
  ) x;
  IF coalesce(array_length(v_careers, 1), 0) <> 2 THEN RAISE EXCEPTION 'TEST_REQUIRES_CAREERS_FROM_DIFF_DIVISIONS'; END IF;
  
  SELECT array_agg(id) INTO v_careers_single FROM (
    SELECT id FROM public.careers WHERE is_active AND NOT is_demo LIMIT 1
  ) y;

  -- 1. Create Academic Single Division (duration 60 -> 2 sessions)
  v_result := public.create_workshop_submission_internal(jsonb_build_object(
    'facilitator_name', 'Fase 9D Acad Single', 'facilitator_email', 'single@test.invalid',
    'activity_type', 'academica', 'title', 'Taller Single', 'student_pitch', 'Pitch',
    'objective', 'Obj', 'takeaway', 'Take',
    'keywords', jsonb_build_array('uno', 'dos', 'tres'), 'session_duration_minutes', 60, 'capacity_per_session', 20,
    'building', 'Ed', 'room_space', 'Salón', 'career_ids', to_jsonb(v_careers_single)));
  v_id_single := (v_result->>'submission_id')::uuid;

  PERFORM public.workshop_review_transition_internal(v_actor, v_id_single, 'start_review');
  PERFORM public.workshop_review_transition_internal(v_actor, v_id_single, 'approve');
  v_result := public.publish_workshop_submission_internal(v_actor, v_id_single);
  v_act_single := (v_result->>'activity_id')::uuid;

  IF (v_result->>'session_count')::int <> 2 THEN RAISE EXCEPTION 'SESSION_COUNT_60_FAILED'; END IF;
  IF (SELECT division_id FROM public.activities WHERE id = v_act_single) IS NULL THEN RAISE EXCEPTION 'SINGLE_DIV_NULL_FAILED'; END IF;

  -- 2. Create Academica multi-division duration 30
  v_result := public.create_workshop_submission_internal(jsonb_build_object(
    'facilitator_name', 'Fase 9D Acad', 'facilitator_email', '9d@test.invalid',
    'activity_type', 'academica', 'title', 'Taller 9D multi', 'student_pitch', 'Pitch',
    'objective', 'Obj', 'takeaway', 'Take',
    'keywords', jsonb_build_array('uno', 'dos', 'tres'), 'session_duration_minutes', 30, 'capacity_per_session', 20,
    'building', 'Ed', 'room_space', 'Salón', 'career_ids', to_jsonb(v_careers)));
  v_id := (v_result->>'submission_id')::uuid;

  PERFORM public.workshop_review_transition_internal(v_actor, v_id, 'start_review');
  
  -- Publish without approve rejected
  BEGIN
    PERFORM public.publish_workshop_submission_internal(v_actor, v_id);
    RAISE EXCEPTION 'PUBLISH_WITHOUT_APPROVE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INVALID_TRANSITION' THEN RAISE; END IF;
  END;

  -- Approve
  v_result := public.workshop_review_transition_internal(v_actor, v_id, 'approve');
  IF v_result->>'status' <> 'approved' THEN RAISE EXCEPTION 'APPROVE_FAILED'; END IF;
  
  -- Publish multi-division academic
  v_result := public.publish_workshop_submission_internal(v_actor, v_id);
  v_act := (v_result->>'activity_id')::uuid;
  
  IF v_result->>'status' <> 'published' THEN RAISE EXCEPTION 'PUBLISH_FAILED'; END IF;
  IF (v_result->>'session_count')::int <> 4 THEN RAISE EXCEPTION 'SESSION_COUNT_30_FAILED'; END IF;
  IF (v_result->>'career_count')::int <> 2 THEN RAISE EXCEPTION 'CAREER_COUNT_FAILED'; END IF;
  
  -- Session timestamps exact check (10:00)
  SELECT starts_at INTO v_sess_start FROM public.activity_sessions WHERE activity_id = v_act ORDER BY starts_at LIMIT 1;
  IF v_sess_start <> ((SELECT event_date FROM public.editions WHERE id = v_edition) + '10:00:00'::time) AT TIME ZONE 'America/Cancun' THEN
    RAISE EXCEPTION 'SESSION_TIMESTAMPS_FAILED';
  END IF;

  -- Check credits = 1
  IF EXISTS (SELECT 1 FROM public.activity_sessions WHERE activity_id = v_act AND credits <> 1) THEN
    RAISE EXCEPTION 'CREDITS_FAILED';
  END IF;

  SELECT count(*), max(encode(qr_token_hash, 'hex')) INTO v_sess_count, v_token_hash FROM public.activity_credentials WHERE activity_id = v_act;
  IF v_sess_count <> 1 THEN RAISE EXCEPTION 'CREDENTIAL_COUNT_FAILED'; END IF;

  IF (SELECT division_id FROM public.activities WHERE id = v_act) IS NOT NULL THEN RAISE EXCEPTION 'MULTI_DIV_NULL_FAILED'; END IF;
  
  -- Publish idempotent without rotating credential
  v_result := public.publish_workshop_submission_internal(v_actor, v_id);
  IF (v_result->>'session_count')::int <> 4 THEN RAISE EXCEPTION 'IDEMPOTENCY_FAILED'; END IF;
  SELECT max(encode(qr_token_hash, 'hex')) INTO v_new_token_hash FROM public.activity_credentials WHERE activity_id = v_act;
  IF v_new_token_hash <> v_token_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CREDENTIAL_ROTATED'; END IF;

  -- Integrity violation test
  UPDATE public.workshop_submissions SET published_activity_id = NULL WHERE id = v_id;
  BEGIN
    PERFORM public.publish_workshop_submission_internal(v_actor, v_id);
    RAISE EXCEPTION 'INTEGRITY_CHECK_FAILED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PUBLISH_STATE_INCONSISTENT' THEN RAISE; END IF;
  END;
  UPDATE public.workshop_submissions SET published_activity_id = v_act WHERE id = v_id;

  -- 3. Create Vida Universitaria
  v_result := public.create_workshop_submission_internal(jsonb_build_object(
    'facilitator_name', 'Fase 9D VU', 'facilitator_email', '9dvu@test.invalid',
    'activity_type', 'vida_universitaria', 'experience_category', 'liderazgo',
    'title', 'Taller 9D VU', 'student_pitch', 'Pitch',
    'takeaway', 'Take',
    'keywords', jsonb_build_array('uno', 'dos', 'tres'), 'session_duration_minutes', 60, 'capacity_per_session', 20,
    'building', 'Ed', 'room_space', 'Salón'));
  v_id_vida := (v_result->>'submission_id')::uuid;

  PERFORM public.workshop_review_transition_internal(v_actor, v_id_vida, 'start_review');
  PERFORM public.workshop_review_transition_internal(v_actor, v_id_vida, 'approve');
  v_result := public.publish_workshop_submission_internal(v_actor, v_id_vida);
  v_act_vida := (v_result->>'activity_id')::uuid;

  IF (SELECT experience_category FROM public.activities WHERE id = v_act_vida) <> 'liderazgo' THEN RAISE EXCEPTION 'VU_EXP_CAT_FAILED'; END IF;
  IF (SELECT division_id FROM public.activities WHERE id = v_act_vida) IS NOT NULL THEN RAISE EXCEPTION 'VU_DIV_NULL_FAILED'; END IF;
  IF (SELECT count(*) FROM public.activity_divisions WHERE activity_id = v_act_vida) <> 0 THEN RAISE EXCEPTION 'VU_NO_DIVISIONS_FAILED'; END IF;
  IF (SELECT count(*) FROM public.activity_careers WHERE activity_id = v_act_vida) <> 0 THEN RAISE EXCEPTION 'VU_NO_CAREERS_FAILED'; END IF;

  -- Primitiva de publicación: solo service_role puede ejecutarla
  IF has_function_privilege('anon', 'public.publish_workshop_submission_internal(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'PUBLISH_EXEC_ANON'; END IF;
  IF has_function_privilege('authenticated', 'public.publish_workshop_submission_internal(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'PUBLISH_EXEC_AUTHENTICATED'; END IF;
  IF NOT has_function_privilege('service_role', 'public.publish_workshop_submission_internal(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'PUBLISH_EXEC_SERVICE_ROLE_MISSING'; END IF;

  -- Check operations overview with STAFF context
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_overview := public.event_operations_overview();
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_overview->'sessions') s
    WHERE s->>'activity_id' = v_act::text
  ) THEN RAISE EXCEPTION 'OVERVIEW_DROPPED_NULL_DIVISION_ACTIVITY'; END IF;

  -- Back to the privileged test context BEFORE creating any fixture
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Participant fixtures (privileged context)
  v_pid_auth := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email, role, aud, created_at, updated_at)
  VALUES (v_pid_auth, '00000000-0000-0000-0000-000000000000', 'test_part_9d@test.invalid', 'authenticated', 'authenticated', now(), now());

  INSERT INTO public.participants (id, edition_id, email, is_demo, auth_user_id, full_name, birth_date, origin)
  VALUES (gen_random_uuid(), v_edition, 'test_part_9d@test.invalid', false, v_pid_auth, 'Test Part', '2000-01-01', 'manual') RETURNING id INTO v_pid;

  UPDATE public.participant_profiles SET platform_consent_at = now(), platform_consent_version = (SELECT privacy_notice_version FROM public.editions WHERE id = v_edition) WHERE participant_id = v_pid;

  INSERT INTO public.initial_interests (participant_id, career_id, preference) VALUES (v_pid, v_careers[1], 1);

  -- Recommendations: only the participant (authenticated + participant JWT) context
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pid_auth, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_rec := public.my_recommended_activities();

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Recommendations should include academic multi-division (since they share v_careers[1])
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rec->'recommendations') r
    WHERE r->>'activity_id' = v_act::text
  ) THEN RAISE EXCEPTION 'RECOMMENDATIONS_MISSING_MULTI_DIV'; END IF;

  -- divisions contract: every element carries division_id / division_name / division_code
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rec->'recommendations') r, jsonb_array_elements(r->'divisions') d
    WHERE NOT (d ? 'division_id' AND d ? 'division_name' AND d ? 'division_code') OR d ? 'id' OR d ? 'name' OR d ? 'code'
  ) THEN RAISE EXCEPTION 'RECOMMENDATIONS_DIVISIONS_CONTRACT_FAILED'; END IF;
  -- legacy single-division fields only when exactly one division
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rec->'recommendations') r
    WHERE jsonb_array_length(r->'divisions') <> 1 AND (r->>'division_id' IS NOT NULL OR r->>'division_name' IS NOT NULL OR r->>'division_code' IS NOT NULL)
  ) THEN RAISE EXCEPTION 'RECOMMENDATIONS_LEGACY_DIVISION_MULTI_FAILED'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rec->'recommendations') r
    WHERE jsonb_array_length(r->'divisions') = 1 AND (r->>'division_id' IS DISTINCT FROM r->'divisions'->0->>'division_id'
      OR r->>'division_name' IS DISTINCT FROM r->'divisions'->0->>'division_name'
      OR r->>'division_code' IS DISTINCT FROM r->'divisions'->0->>'division_code')
  ) THEN RAISE EXCEPTION 'RECOMMENDATIONS_LEGACY_DIVISION_SINGLE_FAILED'; END IF;
  -- vida_universitaria (and legacy liderazgo) never enter vocational recommendations
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_rec->'recommendations') r
    WHERE r->>'activity_id' = v_act_vida::text
  ) THEN RAISE EXCEPTION 'RECOMMENDATIONS_INCLUDED_VIDA'; END IF;

  -- Rank counts activity_divisions (direct calls in the privileged context)
  SELECT id INTO v_sess_id FROM public.activity_sessions WHERE activity_id = v_act LIMIT 1;
  INSERT INTO public.attendances (session_id, participant_id, activity_id, credits_granted) VALUES (v_sess_id, v_pid, v_act, 1);

  IF (SELECT count(DISTINCT ad.division_id) FROM public.attendances at JOIN public.activity_divisions ad ON ad.activity_id = at.activity_id WHERE at.participant_id = v_pid) <> 2 THEN RAISE EXCEPTION 'RANK_DIVISIONS_COUNT_FAILED'; END IF;

  v_rank := public.participant_rank_level(v_pid);
  IF v_rank < 1 THEN RAISE EXCEPTION 'RANK_FAILED'; END IF;

  -- Leadership tickets count Vida Universitaria
  SELECT id INTO v_sess_id FROM public.activity_sessions WHERE activity_id = v_act_vida LIMIT 1;
  INSERT INTO public.attendances (session_id, participant_id, activity_id, credits_granted) VALUES (v_sess_id, v_pid, v_act_vida, 1);

  v_tickets := public.participant_tickets(v_pid);
  IF (v_tickets->>'leadership_tickets')::int <> 1 THEN RAISE EXCEPTION 'LEADERSHIP_TICKETS_FAILED'; END IF;

  -- Raffle category preserves behavior
  INSERT INTO public.raffle_categories (edition_id, name, is_demo, required_academic, required_leadership, is_active) VALUES (v_edition, 'Test Cat', false, 0, 0, true);

  IF public.participant_raffle_category(v_pid) IS NULL THEN RAISE EXCEPTION 'RAFFLE_CAT_FAILED'; END IF;

END
$test$;
ROLLBACK;
SELECT 'workshop_publishing_regression_ok' AS result;
