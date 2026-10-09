-- Regresión vigente de check-in. Ejecutar con psql -v ON_ERROR_STOP=1.
-- Los fixtures son DEMO y toda la transacción termina con ROLLBACK.
-- regression_student_flexibility.sql cubre además los límites temporales y cambios de ruta.
BEGIN;
CREATE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',p_uid::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','',true);
  RETURN answer;
END $f$;
CREATE FUNCTION pg_temp.as_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','',true);
  PERFORM set_config('role','anon',true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  RETURN answer;
END $f$;
DO $test$
DECLARE
  ed uuid := active_edition_id();
  coord uuid := gen_random_uuid(); staff uuid := gen_random_uuid(); raffle uuid := gen_random_uuid();
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  div_id uuid; a1 uuid; a2 uuid; s1 uuid; s2 uuid; s3 uuid; pa uuid; pb uuid; pc uuid;
  cred1 jsonb; cred2 jsonb; new_cred jsonb; answer text;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES (coord,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.coord@test.invalid','{}','{}',now(),now()),
         (staff,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.staff@test.invalid','{}','{}',now(),now()),
         (raffle,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.raffle@test.invalid','{}','{}',now(),now()),
         (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.a@test.invalid','{}','{}',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.b@test.invalid','{}','{}',now(),now()),
         (uc,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.checkin.c@test.invalid','{}','{}',now(),now());
  INSERT INTO staff_members(user_id,role,full_name,is_active,email)
  VALUES (coord,'coordinacion','6B Check-in Coord DEMO',true,'sixb.checkin.coord@test.invalid'),
         (staff,'staff','6B Check-in Staff DEMO',true,'sixb.checkin.staff@test.invalid'),
         (raffle,'sorteo','6B Check-in Sorteo DEMO',true,'sixb.checkin.raffle@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES (coord,'coordinacion'),(staff,'staff'),(raffle,'sorteo');
  INSERT INTO divisions(code,name,sort_order,is_demo) VALUES ('sixb-checkin','6B Check-in DEMO',9999,true) RETURNING id INTO div_id;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES (ed,'sixb.checkin.a@test.invalid','6B Alumno A DEMO','demo',true,ua) RETURNING id INTO pa;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES (ed,'sixb.checkin.b@test.invalid','6B Alumno B DEMO','demo',true,ub) RETURNING id INTO pb;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES (ed,'sixb.checkin.c@test.invalid','6B Alumno C DEMO','demo',true,uc) RETURNING id INTO pc;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version,platform_consent_at=now()
  FROM participants p JOIN editions e ON e.id=p.edition_id WHERE pp.participant_id=p.id AND p.email LIKE 'sixb.checkin.%@test.invalid';
  INSERT INTO activities(edition_id,division_id,title,description,location,is_demo)
  VALUES (ed,div_id,'6B Check-in A DEMO','','Sala DEMO',true) RETURNING id INTO a1;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
  VALUES (a1,now()-interval '5 min',now()+interval '25 min',5,'Sala DEMO','activa',true,1) RETURNING id INTO s1;
  cred1 := rotate_activity_credential(a1);
  INSERT INTO activities(edition_id,division_id,title,description,location,is_demo)
  VALUES (ed,div_id,'6B Check-in B DEMO','','Sala DEMO',true) RETURNING id INTO a2;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
  VALUES (a2,now()-interval '5 min',now()+interval '25 min',5,'Sala DEMO','activa',true,1) RETURNING id INTO s2;
  cred2 := rotate_activity_credential(a2);
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (pa,s1,a1),(pb,s2,a2),(pc,s2,a2);
  IF (SELECT count(*) FROM activity_credentials WHERE activity_id IN (a1,a2)) <> 2
  THEN RAISE EXCEPTION 'ACTIVITY_CREDENTIAL_CONTRACT'; END IF;
  answer := pg_temp.as_user(ub,format('select check_in(%L)',cred1->>'qr_token'));
  IF answer <> 'ERR:NO_RESERVATION' THEN RAISE EXCEPTION 'WRONG_WORKSHOP[%]',answer; END IF;
  answer := pg_temp.as_user(ua,$q$select check_in('ZZZZZZ')$q$);
  IF answer <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'INVALID_CREDENTIAL[%]',answer; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',cred1->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'already_registered') <> 'false'
     OR NOT EXISTS (SELECT 1 FROM attendances WHERE participant_id=pa AND activity_id=a1 AND session_id=s1 AND method='qr')
  THEN RAISE EXCEPTION 'QR_CHECKIN[%]',answer; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',cred1->>'manual_code'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'already_registered') <> 'true'
     OR (SELECT count(*) FROM attendances WHERE participant_id=pa AND activity_id=a1) <> 1
  THEN RAISE EXCEPTION 'IDEMPOTENCE[%]',answer; END IF;
  answer := pg_temp.as_user(ua,'select my_progress()');
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'stamps')::int < 1 THEN RAISE EXCEPTION 'PROGRESS[%]',answer; END IF;

  -- El código manual debe servir también como PRIMER check-in, no solo como reintento de QR.
  answer := pg_temp.as_user(ub,format('select check_in(%L)',cred2->>'manual_code'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'already_registered') <> 'false'
     OR (answer::jsonb->>'method') <> 'codigo_manual'
     OR (SELECT count(*) FROM attendances WHERE participant_id=pb AND activity_id=a2 AND method='codigo_manual') <> 1
  THEN RAISE EXCEPTION 'MANUAL_FIRST_CHECKIN[%]',answer; END IF;
  answer := pg_temp.as_user(ub,format('select check_in(%L)',cred2->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'already_registered') <> 'true'
     OR (answer::jsonb->>'method') <> 'codigo_manual'
     OR (SELECT count(*) FROM attendances WHERE participant_id=pb AND activity_id=a2) <> 1
     OR (SELECT method FROM attendances WHERE participant_id=pb AND activity_id=a2) <> 'codigo_manual'
  THEN RAISE EXCEPTION 'MANUAL_THEN_QR_IDEMPOTENCE[%]',answer; END IF;

  -- Las tablas privadas y la clave no se exponen a participantes ni a anon.
  answer := pg_temp.as_user(ua,format('select activity_credential_display(%L::uuid)',a1));
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'PARTICIPANT_DISPLAY[%]',answer; END IF;
  IF pg_temp.as_user(ua,'select count(*) from activity_credentials') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(ua,'select count(*) from attendances') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_user(ua,'select credential_encryption_key()') NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'PARTICIPANT_PRIVATE_ACCESS'; END IF;
  IF pg_temp.as_anon('select credential_encryption_key()') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_anon('select count(*) from activity_credentials') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_anon('select count(*) from attendances') NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'ANON_PRIVATE_ACCESS'; END IF;

  -- Staff puede operar el módulo, Sorteo no; solo Coordinación regenera.
  answer := pg_temp.as_user(staff,'select activity_checkin_overview()');
  IF answer LIKE 'ERR:%' OR NOT (answer::jsonb @> jsonb_build_array(jsonb_build_object('activity_id',a1)))
  THEN RAISE EXCEPTION 'STAFF_OVERVIEW[%]',answer; END IF;
  answer := pg_temp.as_user(staff,format('select activity_credential_display(%L::uuid)',a1));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'qr_token') <> cred1->>'qr_token'
  THEN RAISE EXCEPTION 'STAFF_DISPLAY[%]',answer; END IF;
  answer := pg_temp.as_user(staff,format('select regenerate_activity_credential(%L::uuid,%L)',a2,'6B motivo válido'));
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'STAFF_REGEN[%]',answer; END IF;
  answer := pg_temp.as_user(coord,'select activity_checkin_overview()');
  IF answer LIKE 'ERR:%' OR NOT (answer::jsonb @> jsonb_build_array(jsonb_build_object('activity_id',a2)))
  THEN RAISE EXCEPTION 'COORD_OVERVIEW[%]',answer; END IF;
  answer := pg_temp.as_user(coord,format('select activity_credential_display(%L::uuid)',a2));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'manual_code') <> cred2->>'manual_code'
  THEN RAISE EXCEPTION 'COORD_DISPLAY[%]',answer; END IF;
  answer := pg_temp.as_user(raffle,'select activity_checkin_overview()');
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'RAFFLE_OVERVIEW[%]',answer; END IF;
  answer := pg_temp.as_user(raffle,format('select activity_credential_display(%L::uuid)',a2));
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'RAFFLE_DISPLAY[%]',answer; END IF;
  answer := pg_temp.as_user(raffle,format('select regenerate_activity_credential(%L::uuid,%L)',a2,'6B motivo válido'));
  IF answer <> 'ERR:NOT_AUTHORIZED' THEN RAISE EXCEPTION 'RAFFLE_REGEN[%]',answer; END IF;

  UPDATE activity_sessions SET status='cancelada' WHERE id=s2;
  answer := pg_temp.as_user(uc,format('select check_in(%L)',cred2->>'qr_token'));
  IF answer <> 'ERR:SESSION_CANCELLED' THEN RAISE EXCEPTION 'CANCELLED[%]',answer; END IF;
  answer := pg_temp.as_user(coord,format('select regenerate_activity_credential(%L::uuid,%L)',a2,'6B prueba regeneración'));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'REGEN[%]',answer; END IF;
  new_cred := answer::jsonb;
  IF new_cred->>'qr_token' IS NULL OR new_cred->>'manual_code' IS NULL THEN RAISE EXCEPTION 'REGEN_NO_CREDENTIAL'; END IF;
  answer := pg_temp.as_user(uc,format('select check_in(%L)',cred2->>'qr_token'));
  IF answer <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'OLD_TOKEN_VALID[%]',answer; END IF;
  answer := pg_temp.as_user(uc,format('select check_in(%L)',cred2->>'manual_code'));
  IF answer <> 'ERR:INVALID_CREDENTIAL' THEN RAISE EXCEPTION 'OLD_MANUAL_CODE_VALID[%]',answer; END IF;
  -- La cancelación conserva la reservación anterior como cancelada_sesion; la nueva credencial
  -- se comprueba con una sesión y una reservación nuevas del mismo taller.
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
  VALUES (a2,now()+interval '30 min',now()+interval '60 min',5,'Sala DEMO','activa',true,1) RETURNING id INTO s3;
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (pc,s3,a2);
  answer := pg_temp.as_user(uc,format('select check_in(%L)',new_cred->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'already_registered') <> 'false'
     OR NOT EXISTS (SELECT 1 FROM attendances WHERE participant_id=pc AND activity_id=a2 AND method='qr')
  THEN RAISE EXCEPTION 'NEW_CREDENTIAL_INVALID[%]',answer; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action='attendance.checked_in' AND detail->>'activity_id'=a1::text)
     OR NOT EXISTS (SELECT 1 FROM audit_log WHERE action='checkin.credential_regenerated' AND detail->>'activity_id'=a2::text)
  THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
  RAISE NOTICE 'ASISTENCIA_OK: QR, código inicial, idempotencia, permisos, sesión cancelada, progreso, regeneración';
END $test$;
ROLLBACK;
