-- Run only against an isolated local database. The entire fixture and reset are rolled back.
BEGIN;
DO $test$
DECLARE
  ed uuid := public.active_edition_id();
  other_ed uuid;
  actor uuid := gen_random_uuid();
  noncoord uuid := gen_random_uuid();
  demo_staff uuid := gen_random_uuid();
  student_auth uuid := gen_random_uuid();
  p_real uuid := gen_random_uuid();
  p_demo uuid := gen_random_uuid();
  d_real uuid; d_demo uuid; c_real uuid; c_demo uuid;
  a uuid; s uuid; batch uuid; proposal uuid; prize uuid; category uuid;
  before_audit bigint; before_theme bigint; before_ranks bigint; before_real_categories bigint;
  preview jsonb; result jsonb; run_id uuid; old_claim text;
BEGIN
  SELECT id INTO d_real FROM public.divisions WHERE NOT is_demo ORDER BY id LIMIT 1;
  SELECT id INTO c_real FROM public.careers WHERE division_id=d_real AND NOT is_demo ORDER BY id LIMIT 1;
  IF d_real IS NULL OR c_real IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_REAL_CATALOG'; END IF;
  INSERT INTO auth.users(id,instance_id,email,aud,role,created_at,updated_at)
    VALUES (actor,'00000000-0000-0000-0000-000000000000','ena.perez@anahuac.mx','authenticated','authenticated',now(),now()),
      (noncoord,'00000000-0000-0000-0000-000000000000','ux2.staff@test.invalid','authenticated','authenticated',now(),now()),
      (demo_staff,'00000000-0000-0000-0000-000000000000','ux2.fixture@test.invalid','authenticated','authenticated',now(),now()),
      (student_auth,'00000000-0000-0000-0000-000000000000','p.'||p_real::text||'@participantes.diaov.invalid','authenticated','authenticated',now(),now());
  INSERT INTO public.staff_members(user_id,role,full_name,email,is_active,is_demo)
    VALUES(actor,'coordinacion','Ena fixture','ena.perez@anahuac.mx',true,false),
      (noncoord,'staff','Staff fixture','ux2.staff@test.invalid',true,false),
      (demo_staff,'staff','Temporary fixture','ux2.fixture@test.invalid',true,true);
  INSERT INTO public.staff_roles(user_id,role) VALUES(actor,'coordinacion'),(noncoord,'staff'),(demo_staff,'staff');
  INSERT INTO public.editions(code,name,event_date,is_active,mode)
    VALUES('UX2_OTHER','Other edition','2026-10-16',false,'preparacion') RETURNING id INTO other_ed;
  INSERT INTO public.divisions(code,name,is_demo) VALUES('UX2_DEMO_D','UX2 temporary',true) RETURNING id INTO d_demo;
  INSERT INTO public.careers(code,name,division_id,is_demo) VALUES('UX2_DEMO_C','UX2 temporary',d_demo,true) RETURNING id INTO c_demo;
  INSERT INTO public.theme_versions(edition_id,status,config) VALUES(ed,'published','{}'::jsonb);
  INSERT INTO public.rank_levels(edition_id,level,required_attendances,required_divisions) VALUES(ed,1,0,0)
    ON CONFLICT(edition_id,level) DO NOTHING;
  INSERT INTO public.audit_log(edition_id,actor_user_id,action,detail) VALUES(ed,actor,'ux2.prior','{}'::jsonb);
  SELECT count(*) INTO before_audit FROM public.audit_log WHERE edition_id=ed AND action='ux2.prior';
  SELECT count(*) INTO before_theme FROM public.theme_versions WHERE edition_id=ed AND status='published';
  SELECT count(*) INTO before_ranks FROM public.rank_levels WHERE edition_id=ed;
  SELECT count(*) INTO before_real_categories FROM public.raffle_categories WHERE edition_id=ed AND NOT is_demo;
  SELECT id INTO category FROM public.raffle_categories WHERE edition_id=ed AND NOT is_demo LIMIT 1;
  INSERT INTO public.raffle_prizes(edition_id,category_id,name,quantity,is_demo)
    VALUES(ed,category,'UX2 real prize',1,false) RETURNING id INTO prize;
  INSERT INTO public.import_batches(edition_id,kind,file_name,is_demo) VALUES(ed,'participants','ux2.csv',false) RETURNING id INTO batch;
  INSERT INTO public.participants(id,edition_id,email,full_name,birth_date,origin,initial_career_id,auth_user_id,is_demo,import_batch_id)
    VALUES(p_real,ed,'ux2.real@test.invalid','Real fixture','2007-01-01','forms',c_real,student_auth,false,batch),
      (p_demo,ed,'ux2.demo@test.invalid','Demo fixture','2007-01-01','demo',c_demo,NULL,true,NULL);
  INSERT INTO public.initial_interests(participant_id,preference,career_id) VALUES(p_real,1,c_real);
  INSERT INTO public.post_event_interests(participant_id,preference,career_id) VALUES(p_real,1,c_real);
  INSERT INTO public.participant_import_conflicts(participant_id,batch_id,field,imported_value) VALUES(p_real,batch,'phone','123');
  INSERT INTO public.activities(edition_id,division_id,title,is_demo) VALUES(ed,d_real,'UX2 active workshop',false) RETURNING id INTO a;
  INSERT INTO public.activity_sessions(activity_id,starts_at,ends_at,capacity,is_demo)
    VALUES(a,now()+interval '1 day',now()+interval '1 day 1 hour',20,false) RETURNING id INTO s;
  INSERT INTO public.reservations(participant_id,session_id,activity_id) VALUES(p_real,s,a);
  INSERT INTO public.attendances(participant_id,session_id,activity_id) VALUES(p_real,s,a);
  INSERT INTO public.raffle_winners(edition_id,category_id,prize_id,participant_id,is_demo)
    VALUES(ed,category,prize,p_real,false);
  INSERT INTO public.workshop_submissions(edition_id,status,is_demo,submitted_at,facilitator_name,facilitator_email,
    activity_type,title,student_pitch,objective,takeaway,keywords,session_duration_minutes,capacity_per_session,
    operating_start_time,operating_end_time,break_minutes,building,room_space)
    VALUES(ed,'approved',false,now(),'UX2','ux2@test.invalid','academica','UX2 proposal','Pitch','Objetivo','Takeaway',ARRAY['ux2','test','reset'],30,20,'10:00','12:00',0,'Edificio','Sala') RETURNING id INTO proposal;
  INSERT INTO public.workshop_submission_careers(submission_id,career_id) VALUES(proposal,c_real);
  INSERT INTO public.participants(edition_id,email,full_name,birth_date,origin,is_demo)
    VALUES(other_ed,'ux2.other@test.invalid','Other fixture','2007-01-01','forms',false);

  IF has_function_privilege('anon','public.reset_preparation_internal(uuid,text)','EXECUTE') OR
    has_function_privilege('authenticated','public.reset_preparation_internal(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC_RESET_GRANT'; END IF;
  BEGIN PERFORM public.reset_preparation_internal(noncoord,'REINICIAR PREPARACIÓN'); RAISE EXCEPTION 'NON_COORD_ALLOWED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF; END;
  BEGIN PERFORM public.reset_preparation_internal(actor,'WRONG'); RAISE EXCEPTION 'WRONG_PHRASE_ALLOWED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'WRONG_PHRASE' THEN RAISE; END IF; END;
  preview := public.preparation_reset_preview_internal(actor);
  IF (preview->'counts'->>'participants')::int <> 2 OR (preview->'counts'->>'proposals')::int <> 1
    OR (preview->'counts'->>'activities')::int <> 1 OR (preview->'counts'->>'sessions')::int <> 1
    OR (preview->'counts'->>'reservations')::int <> 1 OR (preview->'counts'->>'attendances')::int <> 1
    OR (preview->'counts'->>'auth_identities')::int <> 1 THEN RAISE EXCEPTION 'PREVIEW_INCORRECT: %',preview; END IF;
  old_claim := current_setting('request.jwt.claim.sub',true);
  PERFORM set_config('request.jwt.claim.sub',student_auth::text,true);
  IF public.current_participant_id() <> p_real THEN RAISE EXCEPTION 'STUDENT_NOT_LINKED_BEFORE'; END IF;
  result := public.reset_preparation_internal(actor,'REINICIAR PREPARACIÓN');
  run_id := (result->>'reset_id')::uuid;
  IF EXISTS(SELECT 1 FROM public.participants WHERE edition_id=ed) OR EXISTS(SELECT 1 FROM public.workshop_submissions WHERE edition_id=ed)
    OR EXISTS(SELECT 1 FROM public.activities WHERE edition_id=ed) OR EXISTS(SELECT 1 FROM public.import_batches WHERE edition_id=ed)
    OR EXISTS(SELECT 1 FROM public.raffle_winners WHERE edition_id=ed) THEN RAISE EXCEPTION 'OPERATIONAL_REMAINS'; END IF;
  IF EXISTS(SELECT 1 FROM public.reservations r WHERE r.activity_id=a) OR EXISTS(SELECT 1 FROM public.attendances t WHERE t.activity_id=a)
    OR EXISTS(SELECT 1 FROM public.activity_sessions WHERE id=s) OR EXISTS(SELECT 1 FROM public.participant_profiles WHERE participant_id=p_real)
    OR EXISTS(SELECT 1 FROM public.initial_interests WHERE participant_id=p_real)
    OR EXISTS(SELECT 1 FROM public.post_event_interests WHERE participant_id=p_real)
    OR EXISTS(SELECT 1 FROM public.participant_import_conflicts WHERE participant_id=p_real) THEN RAISE EXCEPTION 'DEPENDENTS_REMAIN'; END IF;
  IF EXISTS(SELECT 1 FROM public.careers WHERE id=c_demo) OR EXISTS(SELECT 1 FROM public.divisions WHERE id=d_demo) THEN RAISE EXCEPTION 'TEMPORARY_CATALOG_REMAINS'; END IF;
  IF EXISTS(SELECT 1 FROM public.staff_members WHERE user_id=demo_staff)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=demo_staff) THEN RAISE EXCEPTION 'TEMPORARY_STAFF_CLEANUP_FAILED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.careers WHERE id=c_real) OR NOT EXISTS(SELECT 1 FROM public.divisions WHERE id=d_real)
    OR NOT EXISTS(SELECT 1 FROM public.raffle_prizes WHERE id=prize) OR (SELECT count(*) FROM public.raffle_categories WHERE edition_id=ed AND NOT is_demo) <> before_real_categories
    OR (SELECT count(*) FROM public.theme_versions WHERE edition_id=ed AND status='published') <> before_theme
    OR (SELECT count(*) FROM public.rank_levels WHERE edition_id=ed) <> before_ranks
    OR (SELECT count(*) FROM public.audit_log WHERE edition_id=ed AND action='ux2.prior') <> before_audit
    OR NOT EXISTS(SELECT 1 FROM public.staff_members WHERE user_id=actor AND is_active)
    OR NOT EXISTS(SELECT 1 FROM public.participants WHERE edition_id=other_ed)
    THEN RAISE EXCEPTION 'PERSISTENT_STATE_LOST'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE edition_id=ed AND actor_user_id=actor AND action='preparation.reset' AND detail->>'reset_id'=run_id::text)
    OR (SELECT last_preparation_reset_at FROM public.editions WHERE id=ed) IS NULL THEN RAISE EXCEPTION 'RESET_AUDIT_MISSING'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.preparation_auth_cleanup WHERE auth_user_id=student_auth AND status='pending') THEN RAISE EXCEPTION 'AUTH_QUEUE_MISSING'; END IF;
  IF public.current_participant_id() IS NOT NULL THEN RAISE EXCEPTION 'OLD_TOKEN_STILL_LINKED'; END IF;
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_claim,''),true);
  result := public.reset_preparation_internal(actor,'REINICIAR PREPARACIÓN');
  IF (result->'counts'->>'participants')::int <> 0 THEN RAISE EXCEPTION 'SECOND_RESET_NOT_EMPTY'; END IF;
  PERFORM public.preparation_auth_cleanup_result_internal(actor,student_auth,false,'AUTH_UNAVAILABLE');
  IF NOT EXISTS(SELECT 1 FROM public.preparation_auth_cleanup WHERE auth_user_id=student_auth AND status='failed') THEN RAISE EXCEPTION 'AUTH_FAILURE_NOT_REPORTED'; END IF;
  PERFORM public.preparation_auth_cleanup_result_internal(actor,student_auth,true,NULL);
  IF EXISTS(SELECT 1 FROM public.preparation_auth_cleanup WHERE auth_user_id=student_auth AND status IN ('pending','failed')) THEN RAISE EXCEPTION 'AUTH_RETRY_FAILED'; END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM public.activate_real_operation('ACTIVAR OPERACIÓN REAL');
  IF (SELECT mode FROM public.editions WHERE id=ed) <> 'operacion_real' THEN RAISE EXCEPTION 'ACTIVATION_FAILED'; END IF;
  BEGIN PERFORM public.reset_preparation_internal(actor,'REINICIAR PREPARACIÓN'); RAISE EXCEPTION 'RESET_AFTER_REAL_ALLOWED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'RESET_DISABLED' THEN RAISE; END IF; END;
  RAISE NOTICE 'preparation_reset_regression_ok';
END
$test$;
ROLLBACK;
