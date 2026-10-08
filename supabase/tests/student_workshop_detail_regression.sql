-- Run after student_workshop_detail_fixture.sql and the new migration, in the same disposable transaction.
-- Any failed assertion raises DETAIL_FAIL; success reports DETAIL_OK and ROLLBACK leaves no data.
CREATE FUNCTION pg_temp.read_detail(who uuid, activity uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', who::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    SELECT public.my_workshop_detail(activity)::text INTO result;
  EXCEPTION WHEN others THEN
    result := 'ERR:' || SQLERRM;
  END;
  PERFORM set_config('role', 'supabase_admin', true);
  RETURN coalesce(result, 'NULL');
END;
$$;

DO $$
DECLARE
  valid uuid := '90000000-0000-4000-8000-000000000001';
  demo uuid := '90000000-0000-4000-8000-000000000002';
  no_notice uuid := '90000000-0000-4000-8000-000000000003';
  unknown_user uuid := '90000000-0000-4000-8000-000000000004';
  real_activity uuid := 'a0000000-0000-4000-8000-000000000001';
  demo_activity uuid := 'a0000000-0000-4000-8000-000000000002';
  legacy_activity uuid := 'a0000000-0000-4000-8000-000000000003';
  detail jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.my_workshop_detail(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.my_workshop_detail(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.my_workshop_detail(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'DETAIL_FAIL[permissions]'; END IF;

  detail := pg_temp.read_detail(valid, real_activity)::jsonb;
  IF detail->>'title' <> 'Publicado' OR detail->>'student_pitch' <> 'Pitch público'
    OR detail->>'objective' <> 'Diseñar un prototipo' OR detail->>'takeaway' <> 'Tu prototipo'
    OR detail->>'requirements' <> 'Zapatos cerrados'
    OR jsonb_array_length(detail->'careers') <> 1 OR jsonb_array_length(detail->'divisions') <> 2
  THEN RAISE EXCEPTION 'DETAIL_FAIL[editorial allowlist]'; END IF;
  IF detail ?| ARRAY['facilitator_email', 'admin_notes', 'review_feedback', 'status', 'sessions', 'reviewed_at']
  THEN RAISE EXCEPTION 'DETAIL_FAIL[private fields]'; END IF;

  detail := pg_temp.read_detail(valid, legacy_activity)::jsonb;
  IF detail->>'title' <> 'Legacy' OR detail->'objective' <> 'null'::jsonb
    OR detail->'takeaway' <> 'null'::jsonb OR detail->'requirements' <> 'null'::jsonb
    OR detail->'divisions'->0->>'name' <> 'Negocios'
  THEN RAISE EXCEPTION 'DETAIL_FAIL[legacy]'; END IF;

  IF pg_temp.read_detail(valid, demo_activity) <> 'NULL' THEN RAISE EXCEPTION 'DETAIL_FAIL[real sees demo]'; END IF;
  IF pg_temp.read_detail(demo, real_activity) <> 'NULL' THEN RAISE EXCEPTION 'DETAIL_FAIL[demo sees real]'; END IF;
  IF pg_temp.read_detail(demo, demo_activity) = 'NULL' THEN RAISE EXCEPTION 'DETAIL_FAIL[demo own activity]'; END IF;
  IF pg_temp.read_detail(valid, 'a0000000-0000-4000-8000-000000000004') <> 'NULL' THEN RAISE EXCEPTION 'DETAIL_FAIL[other edition]'; END IF;
  IF pg_temp.read_detail(valid, 'a0000000-0000-4000-8000-000000000005') <> 'NULL' THEN RAISE EXCEPTION 'DETAIL_FAIL[hidden session]'; END IF;
  IF pg_temp.read_detail(unknown_user, real_activity) <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'DETAIL_FAIL[no participant]'; END IF;
  IF pg_temp.read_detail(no_notice, real_activity) <> 'ERR:PRIVACY_NOTICE_REQUIRED' THEN RAISE EXCEPTION 'DETAIL_FAIL[privacy]'; END IF;
  RAISE NOTICE 'DETAIL_OK';
END;
$$;

ROLLBACK;
