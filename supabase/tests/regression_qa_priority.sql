-- Run only on an isolated database with the two priority migrations installed.
-- No production URL or credentials. Every fixture is rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
CREATE FUNCTION pg_temp.as_student(uid uuid, query text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE query INTO answer;
  EXCEPTION WHEN others THEN answer:=jsonb_build_object('error',SQLERRM); END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','',true);
  RETURN coalesce(answer, 'null'::jsonb);
END $$;
CREATE FUNCTION pg_temp.activity(ed uuid, div uuid, career uuid, seconds_to_start int, duration_minutes int,
  demo boolean DEFAULT false, audience_value text DEFAULT 'students', activity_uuid uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE sid uuid; credential jsonb;
BEGIN
  INSERT INTO activities(id,edition_id,division_id,title,description,is_demo,activity_type,audience)
  VALUES(activity_uuid,ed,div,'QA '||activity_uuid,'QA isolated',demo,'academica',audience_value);
  IF career IS NOT NULL THEN INSERT INTO activity_careers(activity_id,career_id) VALUES(activity_uuid,career); END IF;
  INSERT INTO activity_divisions(activity_id,division_id) VALUES(activity_uuid,div);
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo)
  VALUES(activity_uuid,statement_timestamp()+make_interval(secs=>seconds_to_start),
    statement_timestamp()+make_interval(secs=>seconds_to_start)+make_interval(mins=>duration_minutes),
    30,'activa',demo) RETURNING id INTO sid;
  credential:=rotate_activity_credential(activity_uuid);
  RETURN jsonb_build_object('activity',activity_uuid,'session',sid)||credential;
END $$;
DO $tests$
DECLARE
  ed uuid:=active_edition_id(); divs uuid[]; careers_ uuid[]; uid uuid[]:=ARRAY[
    '48535445-9c74-4777-b152-3211012c20db','23c40ef0-9e3c-47bb-8369-204ae2ab5ac5','85a8d3ed-d5c9-48cd-bdd2-74ab069619a7']::uuid[];
  pid uuid[]:=ARRAY['b2234695-0a1c-458f-b56f-7ab1ccdb2a95','7f99a26f-57de-47a8-b6cf-309d4e93aea9','c0d8426c-50e0-4e59-b8fd-f023ec15af08']::uuid[];
  names text[]:=ARRAY['Biotecnología','Ingeniería en Tecnologías de la Información e Inteligencia Artificial','Negocios Internacionales'];
  offsets int[]:=ARRAY[259200,360,301,300,0,-600,-4200,-4800,-4801];
  a jsonb; rec jsonb; result jsonb; again jsonb; admin_act jsonb; fallback jsonb; own_acts jsonb[]; before_count int; i int; j int;
  rid uuid; category_name text; other_demo jsonb; coord uuid:=gen_random_uuid(); snapshot_before text;
  visibility_states text[]:=ARRAY['none','vigente','cancelada_alumno','cambiada','cancelada_sesion','expirada'];
  reservation_state text; keep_history boolean; board jsonb; exclusive jsonb; ordinary jsonb; change_source jsonb;
  source_reservation uuid;
BEGIN
  UPDATE editions SET mode='preparacion',checkin_open_before_minutes=5,checkin_close_after_minutes=20,
    reservations_open_at=now()-interval '1 day',reservations_close_at=now()+interval '10 days' WHERE id=ed;
  FOR i IN 1..3 LOOP
    INSERT INTO divisions(code,name,is_demo) VALUES('QA-PRIORITY-'||i,'QA '||names[i],false) RETURNING id INTO rid;
    divs:=array_append(divs,rid);
    INSERT INTO careers(code,name,division_id,is_demo) VALUES('QA-PRIORITY-'||i,names[i],rid,false) RETURNING id INTO rid;
    careers_:=array_append(careers_,rid);
    INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(uid[i],'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'audit.diaov.20261012.'||chr(96+i)||'@example.com','{}','{}',now(),now());
    INSERT INTO participants(id,edition_id,email,full_name,phone,high_school,initial_career_id,origin,is_demo,auth_user_id)
    VALUES(pid[i],ed,'audit.diaov.20261012.'||chr(96+i)||'@example.com','QA Alumno '||i,
      '555000260'||i,'Otra escuela',careers_[i],'manual',false,uid[i]);
    UPDATE participant_profiles SET platform_consent_at=now(),
      platform_consent_version=(SELECT privacy_notice_version FROM editions WHERE id=ed) WHERE participant_id=pid[i];
    DELETE FROM initial_interests WHERE participant_id=pid[i];
    INSERT INTO initial_interests(participant_id,preference,career_id,career_raw) VALUES(pid[i],1,careers_[i],'');
    a:=pg_temp.activity(ed,divs[i],careers_[i],300,CASE WHEN i=3 THEN 30 ELSE 60 END);
    own_acts:=array_append(own_acts,a);
  END LOOP;
  admin_act:=pg_temp.activity(ed,divs[1],careers_[1],300,60,false,'educators',
    'cef9d429-d193-49fc-8883-d15a5ee30fdc');
  INSERT INTO activity_careers(activity_id,career_id) VALUES((admin_act->>'activity')::uuid,careers_[2]),((admin_act->>'activity')::uuid,careers_[3]);
  FOR i IN 1..3 LOOP
    fallback:=pg_temp.activity(ed,divs[i],NULL,400,30);
    rec:=pg_temp.as_student(uid[i],'select my_recommended_activities()');
    PERFORM pg_temp.assert_true(rec ? 'summary' AND (rec#>>'{summary,exact}')::int=1,'recommendation summary student '||i);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=own_acts[i]->>'activity' AND r->>'recommendation_type'='exact_career'
      AND r#>>'{matched_careers,0,career_name}'=names[i] AND (r->>'interest_priority')::int=1
      AND (r->>'has_open_session')::boolean),'exact career student '||i);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=fallback->>'activity' AND r->>'recommendation_type'='same_division'
      AND r->'matched_careers'='[]'::jsonb AND r#>>'{matched_division,division_id}'=divs[i]::text),'division complement student '||i);
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=admin_act->>'activity'),'educator recommendation excluded student '||i);
    result:=pg_temp.as_student(uid[i],format('select reserve_session(%L)',admin_act->>'session'));
    PERFORM pg_temp.assert_true(result->>'error'='ACTIVITY_EDUCATORS_ONLY','educator backend reserve rejected student '||i);
    result:=pg_temp.as_student(uid[i],'select my_reservation_board()');
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'sessions') s
      WHERE s->>'activity_id'=admin_act->>'activity'),'educator discovery excluded student '||i);
    result:=pg_temp.as_student(uid[i],format('select my_workshop_detail(%L)',admin_act->>'activity'));
    PERFORM pg_temp.assert_true(result='null'::jsonb,'educator direct detail hidden student '||i);
    result:=pg_temp.as_student(uid[i],format('select reserve_session(%L)',own_acts[i]->>'session'));
    PERFORM pg_temp.assert_true(result ? 'reservation_id','reservation student '||i);
    PERFORM pg_temp.assert_true(session_reserved_count((own_acts[i]->>'session')::uuid)=1,'availability reduces 30 to 29 student '||i);
    rec:=pg_temp.as_student(uid[i],'select my_recommended_activities()');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=own_acts[i]->>'activity' AND (r->>'already_reserved')::boolean),'reserved recommendation student '||i);
    result:=pg_temp.as_student(uid[i],format('select check_in(%L)',own_acts[i]->>'qr_token'));
    PERFORM pg_temp.assert_true((result->>'credits_granted')::int=CASE WHEN i=3 THEN 1 ELSE 2 END,'duration stamps student '||i);
    again:=pg_temp.as_student(uid[i],format('select check_in(%L)',own_acts[i]->>'manual_code'));
    PERFORM pg_temp.assert_true((again->>'already_registered')::boolean AND again->>'attendance_id'=result->>'attendance_id','manual/QR idempotence student '||i);
    rec:=pg_temp.as_student(uid[i],'select my_recommended_activities()');
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=own_acts[i]->>'activity' AND (r->>'already_attended')::boolean),'attended recommendation student '||i);
    PERFORM pg_temp.assert_true(participant_stamp_category(pid[i]) IS NULL,'no category without university life student '||i);
    -- University-life stamp: same QR path, no direct attendance inserts.
    a:=pg_temp.activity(ed,divs[i],NULL,300,30);
    UPDATE activities SET activity_type='vida_universitaria',experience_category='otra' WHERE id=(a->>'activity')::uuid;
    INSERT INTO reservations(participant_id,session_id,activity_id) VALUES(pid[i],(a->>'session')::uuid,(a->>'activity')::uuid);
    result:=pg_temp.as_student(uid[i],format('select check_in(%L)',a->>'manual_code'));
    PERFORM pg_temp.assert_true(result ? 'attendance_id','university life checkin student '||i);
    SELECT name INTO category_name FROM raffle_categories WHERE id=participant_stamp_category(pid[i]);
    PERFORM pg_temp.assert_true(category_name=CASE WHEN i=3 THEN 'Sistema Solar' ELSE 'Galaxia' END,'raffle category student '||i);
  END LOOP;
  FOR j IN 1..array_length(offsets,1) LOOP
    FOR i IN 1..2 LOOP
      a:=pg_temp.activity(ed,divs[1],NULL,offsets[j],60);
      INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at)
      VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid,
        CASE WHEN offsets[j]<-3600 THEN 'expirada' ELSE 'vigente' END,
        CASE WHEN offsets[j]<-3600 THEN now() ELSE NULL END);
      before_count:=(SELECT count(*) FROM attendances WHERE participant_id=pid[1]);
      result:=pg_temp.as_student(uid[1],format('select check_in(%L)',CASE WHEN i=1 THEN a->>'qr_token' ELSE a->>'manual_code' END));
      PERFORM pg_temp.assert_true(
        result ? 'attendance_id'
        AND (result->>'credits_granted')::int=2
        AND (SELECT count(*) FROM attendances WHERE participant_id=pid[1])=before_count+1,
        'checkin without schedule gate offset seconds '||offsets[j]||' method '||i
      );
    END LOOP;
  END LOOP;
  a:=pg_temp.activity(ed,divs[1],NULL,0,60);
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'qr_token'));
  -- Regla vigente (2026-10-15): el QR sin reservación también registra asistencia (sin crear reservación) y es idempotente.
  PERFORM pg_temp.assert_true(result->>'error' IS NULL AND result->>'without_reservation'='true','QR without reservation counts');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM attendances WHERE participant_id=pid[1] AND activity_id=(a->>'activity')::uuid AND reservation_id IS NULL)=1,'one unreserved attendance');
  PERFORM pg_temp.assert_true((SELECT count(*) FROM reservations WHERE participant_id=pid[1] AND activity_id=(a->>'activity')::uuid)=0,'no reservation created');
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'qr_token'));
  PERFORM pg_temp.assert_true(result->>'already_registered'='true','unreserved check-in is idempotent');
  DELETE FROM attendances WHERE participant_id=pid[1] AND activity_id=(a->>'activity')::uuid;  -- el escenario siguiente parte sin asistencia
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid);
  UPDATE activity_sessions SET status='cancelada' WHERE id=(a->>'session')::uuid;
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'manual_code'));
  PERFORM pg_temp.assert_true(result->>'error'='SESSION_CANCELLED','cancelled session');
  other_demo:=pg_temp.activity(ed,divs[1],NULL,0,60,true);
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',other_demo->>'qr_token'));
  PERFORM pg_temp.assert_true(result->>'error'='INVALID_CREDENTIAL','DEMO QR rejected for real student');
  rec:=pg_temp.as_student(uid[1],'select my_recommended_activities()');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
    WHERE r->>'activity_id'=other_demo->>'activity'),'DEMO excluded from real recommendations');
  result:=pg_temp.as_student(uid[1],format('select set_activity_audience(%L,%L)',admin_act->>'activity','students'));
  PERFORM pg_temp.assert_true(result->>'error'='NOT_AUTHORIZED','student cannot edit audience');
  result:=pg_temp.as_student(uid[1],format('select activity_audience(%L)',admin_act->>'activity'));
  PERFORM pg_temp.assert_true(result->>'error'='NOT_AUTHORIZED','student cannot use audience admin RPC');
  -- An existing attendance remains idempotent after closure, even if its session is cancelled.
  a:=pg_temp.activity(ed,divs[1],NULL,-7200,60);
  INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at)
  VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid,'expirada',now()) RETURNING id INTO rid;
  INSERT INTO attendances(participant_id,session_id,activity_id,reservation_id,method)
  VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid,rid,'qr');
  UPDATE activity_sessions SET status='cancelada' WHERE id=(a->>'session')::uuid;
  before_count:=(SELECT count(*) FROM attendances WHERE participant_id=pid[1]);
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'manual_code'));
  PERFORM pg_temp.assert_true((result->>'already_registered')::boolean AND
    (SELECT count(*) FROM attendances WHERE participant_id=pid[1])=before_count,'idempotence after closure and cancellation');
  -- A past reservation still within the window wins over a future reservation of the same activity.
  a:=pg_temp.activity(ed,divs[1],NULL,-2400,30);
  INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at)
  VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid,'expirada',now());
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo)
  VALUES((a->>'activity')::uuid,now()+interval '1 hour',now()+interval '90 minutes',30,'activa',false)
  RETURNING id INTO rid;
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES(pid[1],rid,(a->>'activity')::uuid);
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'qr_token'));
  PERFORM pg_temp.assert_true(result->>'session_id'=a->>'session','legitimate expired reservation preferred to future session');
  -- Window settings retained for compatibility do not gate operational attendance.
  UPDATE editions SET checkin_open_before_minutes=0,checkin_close_after_minutes=0 WHERE id=ed;
  a:=pg_temp.activity(ed,divs[1],NULL,360,60);
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid);
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'manual_code'));
  PERFORM pg_temp.assert_true(result ? 'attendance_id','future checkin with zero opening allowance');
  a:=pg_temp.activity(ed,divs[1],NULL,-7200,60);
  INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at)
  VALUES(pid[1],(a->>'session')::uuid,(a->>'activity')::uuid,'expirada',now());
  result:=pg_temp.as_student(uid[1],format('select check_in(%L)',a->>'qr_token'));
  PERFORM pg_temp.assert_true(result ? 'attendance_id','past checkin with zero closing allowance');
  PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.set_activity_audience(uuid,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.activity_audience(uuid)','EXECUTE'),'audience RPC permissions');
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(coord,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'qa-priority-coord@test.invalid','{}','{}',now(),now());
  INSERT INTO staff_members(user_id,role,full_name,is_active,email)
  VALUES(coord,'coordinacion','QA coordination',true,'qa-priority-coord@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES(coord,'coordinacion');
  SELECT md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM activity_sessions s WHERE s.activity_id=(admin_act->>'activity')::uuid)
    ||(SELECT to_jsonb(c)::text FROM activity_credentials c WHERE c.activity_id=(admin_act->>'activity')::uuid)
    ||(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.career_id)::text FROM activity_careers c WHERE c.activity_id=(admin_act->>'activity')::uuid))
  INTO snapshot_before;
  result:=pg_temp.as_student(coord,format('select to_jsonb(activity_audience(%L))',admin_act->>'activity'));
  PERFORM pg_temp.assert_true(result='"educators"'::jsonb,'coordination reads explicit audience');
  result:=pg_temp.as_student(coord,format('select to_jsonb(set_activity_audience(%L,%L))',admin_act->>'activity','students'));
  PERFORM pg_temp.assert_true(NOT (result ? 'error') AND
    (SELECT audience FROM activities WHERE id=(admin_act->>'activity')::uuid)='students','coordination can select students');
  result:=pg_temp.as_student(coord,format('select to_jsonb(set_activity_audience(%L,%L))',admin_act->>'activity','educators'));
  PERFORM pg_temp.assert_true(NOT (result ? 'error') AND
    (SELECT audience FROM activities WHERE id=(admin_act->>'activity')::uuid)='educators','coordination can select educators');
  PERFORM pg_temp.assert_true(snapshot_before=md5(
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM activity_sessions s WHERE s.activity_id=(admin_act->>'activity')::uuid)
    ||(SELECT to_jsonb(c)::text FROM activity_credentials c WHERE c.activity_id=(admin_act->>'activity')::uuid)
    ||(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.career_id)::text FROM activity_careers c WHERE c.activity_id=(admin_act->>'activity')::uuid)),
    'audience change preserves sessions capacities QR and career relationships');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM activities WHERE id=(admin_act->>'activity')::uuid)
    AND EXISTS(SELECT 1 FROM activity_credentials WHERE activity_id=(admin_act->>'activity')::uuid),'educator catalog and QR retained');
  -- P2: only itinerary-preserved states justify exposing an exclusive session.
  change_source:=pg_temp.activity(ed,divs[3],careers_[3],259200,30);
  INSERT INTO reservations(participant_id,session_id,activity_id)
  VALUES(pid[3],(change_source->>'session')::uuid,(change_source->>'activity')::uuid)
  RETURNING id INTO source_reservation;
  FOREACH reservation_state IN ARRAY visibility_states LOOP
    keep_history:=reservation_state IN ('vigente','cancelada_sesion','expirada');
    exclusive:=pg_temp.activity(ed,divs[3],careers_[3],
      CASE WHEN reservation_state='expirada' THEN -7200 ELSE 172800 END,30);
    ordinary:=pg_temp.activity(ed,divs[3],careers_[3],
      CASE WHEN reservation_state='expirada' THEN -7200 ELSE 172800 END,30);
    IF reservation_state<>'none' THEN
      INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at)
      VALUES(pid[3],(exclusive->>'session')::uuid,(exclusive->>'activity')::uuid,reservation_state,
        CASE WHEN reservation_state='vigente' THEN NULL ELSE now() END),
        (pid[3],(ordinary->>'session')::uuid,(ordinary->>'activity')::uuid,reservation_state,
        CASE WHEN reservation_state='vigente' THEN NULL ELSE now() END);
    END IF;
    IF reservation_state='cancelada_sesion' THEN
      UPDATE activity_sessions SET status='cancelada'
      WHERE id IN ((exclusive->>'session')::uuid,(ordinary->>'session')::uuid);
    END IF;
    -- The reservation predates the audience change; ordinary activity remains unchanged.
    UPDATE activities SET audience='educators' WHERE id=(exclusive->>'activity')::uuid;
    board:=pg_temp.as_student(uid[3],'select my_reservation_board()');
    PERFORM pg_temp.assert_true(NOT (board ? 'error'),'P2 board succeeds: '||reservation_state);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(board->'sessions') s
      WHERE s->>'id'=exclusive->>'session')=keep_history,'P2 exclusive session visibility: '||reservation_state);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(board->'reservations') r
      WHERE r->>'session_id'=exclusive->>'session' AND r->>'status'=reservation_state)=keep_history,
      'P2 exclusive itinerary coherent: '||reservation_state);
    IF keep_history THEN
      PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(board->'reservations') r
        WHERE r->>'session_id'=exclusive->>'session'
        AND r->>'derived_status'=CASE reservation_state WHEN 'vigente' THEN 'active'
          WHEN 'cancelada_sesion' THEN 'cancelled' ELSE 'expired' END),'P2 derived history preserved: '||reservation_state);
    END IF;
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(board->'sessions') s
      WHERE s->>'id'=ordinary->>'session'),'P2 ordinary session remains visible: '||reservation_state);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(board->'reservations') r
      WHERE r->>'session_id'=ordinary->>'session' AND r->>'status'=reservation_state)=keep_history,
      'P2 ordinary itinerary unchanged: '||reservation_state);
    result:=pg_temp.as_student(uid[3],format('select reserve_session(%L)',exclusive->>'session'));
    PERFORM pg_temp.assert_true(result->>'error'='ACTIVITY_EDUCATORS_ONLY','P2 reserve exclusive rejected: '||reservation_state);
    result:=pg_temp.as_student(uid[3],format('select change_reservation(%L,%L)',source_reservation,exclusive->>'session'));
    PERFORM pg_temp.assert_true(result->>'error'='ACTIVITY_EDUCATORS_ONLY','P2 change to exclusive rejected: '||reservation_state);
    PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM reservations WHERE id=source_reservation AND status='vigente'),
      'P2 failed change retains original reservation: '||reservation_state);
    rec:=pg_temp.as_student(uid[3],'select my_recommended_activities()');
    PERFORM pg_temp.assert_true(NOT (rec ? 'error') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rec->'recommendations') r
      WHERE r->>'activity_id'=exclusive->>'activity'),'P2 exclusive excluded from recommendations: '||reservation_state);
    result:=pg_temp.as_student(uid[3],format('select my_workshop_detail(%L)',exclusive->>'activity'));
    PERFORM pg_temp.assert_true(result='null'::jsonb,'P2 exclusive detail hidden: '||reservation_state);
  END LOOP;
  RAISE NOTICE 'PRIORITY_QA_OK';
END $tests$;
ROLLBACK;

