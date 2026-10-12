-- Regresión vigente de check-in. Ejecutar con psql -v ON_ERROR_STOP=1.
-- Los fixtures son DEMO y toda la transacción termina con ROLLBACK.
-- regression_student_flexibility.sql cubre además los límites temporales y cambios de ruta.
-- Éxito: los dos avisos ASISTENCIA_OK y ASISTENCIA_SELLOS_OK, y salida 0.
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

-- Sellos por duración oficial de la sesión: 60 minutos = 2 sellos; cualquier otra duración = 1.
-- Cubre la regla, todas las rutas que crean o editan sesiones, QR y código manual, reintentos y el snapshot.
DO $credits$
DECLARE
  ed uuid := active_edition_id();
  ed_date date; ed_tz text;
  coord uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  div_id uuid; real_career uuid; pa uuid; pb uuid;
  a60 uuid; a45 uuid; a30 uuid; a61 uuid; s60 uuid; s45 uuid; s30 uuid; s61 uuid;
  c60 jsonb; c45 jsonb; c30 jsonb; c61 jsonb;
  answer text; first jsonb; again jsonb;
  payload jsonb; sub60 uuid; sub30 uuid; act60 uuid; act30 uuid; imported uuid; r record;
BEGIN
  SELECT event_date, timezone INTO ed_date, ed_tz FROM editions WHERE id = ed;

  -- 1. La regla, minuto a minuto.
  FOR r IN SELECT * FROM (VALUES (15,1),(30,1),(45,1),(59,1),(60,2),(61,1),(90,1),(120,1)) AS t(minutes, expected) LOOP
    IF session_stamp_credits(now(), now() + make_interval(mins => r.minutes)) <> r.expected THEN
      RAISE EXCEPTION 'CREDIT_RULE[% min -> %]', r.minutes, session_stamp_credits(now(), now() + make_interval(mins => r.minutes));
    END IF;
  END LOOP;
  IF pg_temp.as_anon('select session_stamp_credits(now(), now())') NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'CREDIT_RULE_EXPOSED_TO_ANON'; END IF;

  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES (coord,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.credits.coord@test.invalid','{}','{}',now(),now()),
         (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.credits.a@test.invalid','{}','{}',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sixb.credits.b@test.invalid','{}','{}',now(),now());
  INSERT INTO staff_members(user_id,role,full_name,is_active,email)
  VALUES (coord,'coordinacion','6B Sellos Coord DEMO',true,'sixb.credits.coord@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES (coord,'coordinacion');
  INSERT INTO divisions(code,name,sort_order,is_demo) VALUES ('sixb-credits','6B Sellos DEMO',9998,true) RETURNING id INTO div_id;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES (ed,'sixb.credits.a@test.invalid','6B Sellos A DEMO','demo',true,ua) RETURNING id INTO pa;
  INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
  VALUES (ed,'sixb.credits.b@test.invalid','6B Sellos B DEMO','demo',true,ub) RETURNING id INTO pb;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version,platform_consent_at=now()
  FROM participants p JOIN editions e ON e.id=p.edition_id WHERE pp.participant_id=p.id AND p.email LIKE 'sixb.credits.%@test.invalid';

  -- 2. El valor de la sesión no lo decide quien la escribe: se envían créditos falsos a propósito.
  INSERT INTO activities(edition_id,division_id,title,is_demo) VALUES (ed,div_id,'6B Sellos 60 DEMO',true) RETURNING id INTO a60;
  INSERT INTO activities(edition_id,division_id,title,is_demo) VALUES (ed,div_id,'6B Sellos 45 DEMO',true) RETURNING id INTO a45;
  INSERT INTO activities(edition_id,division_id,title,is_demo) VALUES (ed,div_id,'6B Sellos 30 DEMO',true) RETURNING id INTO a30;
  INSERT INTO activities(edition_id,division_id,title,is_demo) VALUES (ed,div_id,'6B Sellos 61 DEMO',true) RETURNING id INTO a61;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo,credits)
  VALUES (a60,now()-interval '5 min',now()+interval '55 min',5,'activa',true,1) RETURNING id INTO s60;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo,credits)
  VALUES (a45,now()-interval '5 min',now()+interval '40 min',5,'activa',true,2) RETURNING id INTO s45;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo,credits)
  VALUES (a30,now()-interval '5 min',now()+interval '25 min',5,'activa',true,7) RETURNING id INTO s30;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo)
  VALUES (a61,now()-interval '5 min',now()+interval '56 min',5,'activa',true) RETURNING id INTO s61;
  IF (SELECT array_agg(credits ORDER BY ends_at - starts_at) FROM activity_sessions WHERE id IN (s60,s45,s30,s61)) <> ARRAY[1,1,2,1]::smallint[]
  THEN RAISE EXCEPTION 'SESSION_CREDITS_ON_INSERT[%]', (SELECT array_agg(credits ORDER BY ends_at - starts_at) FROM activity_sessions WHERE id IN (s60,s45,s30,s61)); END IF;
  UPDATE activity_sessions SET credits = 2 WHERE id = s30;
  IF (SELECT credits FROM activity_sessions WHERE id = s30) <> 1 THEN RAISE EXCEPTION 'SESSION_CREDITS_OVERRIDDEN_BY_HAND'; END IF;

  c60 := rotate_activity_credential(a60); c45 := rotate_activity_credential(a45);
  c30 := rotate_activity_credential(a30); c61 := rotate_activity_credential(a61);
  INSERT INTO reservations(participant_id,session_id,activity_id)
  VALUES (pa,s60,a60),(pa,s45,a45),(pa,s30,a30),(pa,s61,a61),(pb,s60,a60),(pb,s45,a45);

  -- 3. QR en una sesión de 60 minutos: exactamente 2 sellos, y el alumno no envía ningún valor.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'check_in' AND pronamespace = 'public'::regnamespace) <> 1
     OR (SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'check_in' AND pronamespace = 'public'::regnamespace) <> 'p_credential text'
  THEN RAISE EXCEPTION 'CHECK_IN_SIGNATURE'; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c60->>'qr_token'));
  IF answer LIKE 'ERR:%' THEN RAISE EXCEPTION 'QR_60[%]',answer; END IF;
  first := answer::jsonb;
  IF (first->>'already_registered') <> 'false' OR (first->>'credits_granted')::int <> 2 OR (first->>'stamps')::int <> 2
     OR (first->>'attended_workshops')::int <> 1 OR (first->>'method') <> 'qr'
     OR (SELECT credits_granted FROM attendances WHERE participant_id=pa AND activity_id=a60) <> 2
  THEN RAISE EXCEPTION 'QR_60_TWO_STAMPS[%]',answer; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE action='attendance.checked_in' AND detail->>'activity_id'=a60::text
                 AND detail->>'participant_id'=pa::text AND (detail->>'credits_granted')::int = 2)
  THEN RAISE EXCEPTION 'CHECKIN_AUDIT_WITHOUT_CREDITS'; END IF;

  -- 4. Volver a escanear (QR o código) la misma asistencia no suma nada.
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c60->>'qr_token'));
  again := answer::jsonb;
  IF (again->>'already_registered') <> 'true' OR (again->>'credits_granted')::int <> 2 OR (again->>'stamps')::int <> 2
  THEN RAISE EXCEPTION 'RESCAN_QR[%]',answer; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c60->>'manual_code'));
  again := answer::jsonb;
  IF (again->>'already_registered') <> 'true' OR (again->>'stamps')::int <> 2
     OR (SELECT count(*) FROM attendances WHERE participant_id=pa AND activity_id=a60) <> 1
     OR (SELECT sum(credits_granted) FROM attendances WHERE participant_id=pa) <> 2
  THEN RAISE EXCEPTION 'RESCAN_MANUAL[%]',answer; END IF;

  -- 5. 45 minutos = 1 sello; 30 y 61 minutos tampoco reciben 2.
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c45->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 1 OR (answer::jsonb->>'stamps')::int <> 3
  THEN RAISE EXCEPTION 'QR_45_ONE_STAMP[%]',answer; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c30->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 1 OR (answer::jsonb->>'stamps')::int <> 4
  THEN RAISE EXCEPTION 'QR_30_ONE_STAMP[%]',answer; END IF;
  answer := pg_temp.as_user(ua,format('select check_in(%L)',c61->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 1 OR (answer::jsonb->>'stamps')::int <> 5
  THEN RAISE EXCEPTION 'QR_61_ONE_STAMP[%]',answer; END IF;

  -- 6. El código manual acredita exactamente lo mismo que el QR.
  answer := pg_temp.as_user(ub,format('select check_in(%L)',c60->>'manual_code'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'method') <> 'codigo_manual' OR (answer::jsonb->>'credits_granted')::int <> 2
     OR (answer::jsonb->>'stamps')::int <> 2
  THEN RAISE EXCEPTION 'MANUAL_60_TWO_STAMPS[%]',answer; END IF;
  answer := pg_temp.as_user(ub,format('select check_in(%L)',c45->>'manual_code'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 1 OR (answer::jsonb->>'stamps')::int <> 3
  THEN RAISE EXCEPTION 'MANUAL_45_ONE_STAMP[%]',answer; END IF;

  -- 7. Bitácora: el total de sellos suma lo acreditado (no cuenta talleres).
  answer := pg_temp.as_user(ua,'select my_progress()');
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'stamps')::int <> 5 OR (answer::jsonb->>'attended_workshops')::int <> 4
  THEN RAISE EXCEPTION 'PROGRESS_TOTAL[%]',answer; END IF;
  answer := pg_temp.as_user(ua,'select my_reservation_board()');
  IF answer LIKE 'ERR:%' OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(answer::jsonb->'reservations') x
       WHERE x->>'session_id' = s60::text AND (x->>'credits_granted')::int = 2)
  THEN RAISE EXCEPTION 'BOARD_CREDITS_GRANTED[%]',left(answer,300); END IF;

  -- 8. Snapshot: si después se edita el horario, la sesión se recalcula y la asistencia ya acreditada no cambia.
  --    (El horario de una sesión con reservaciones está bloqueado; se liberan solo para poder simular la edición.)
  UPDATE reservations SET status='cancelada_alumno', ended_at=now() WHERE session_id IN (s60, s45);
  UPDATE activity_sessions SET ends_at = starts_at + interval '30 min' WHERE id = s60;
  IF (SELECT credits FROM activity_sessions WHERE id = s60) <> 1
     OR (SELECT credits_granted FROM attendances WHERE participant_id=pa AND activity_id=a60) <> 2
     OR my_stamp_count(pa) <> 5
  THEN RAISE EXCEPTION 'SNAPSHOT_NOT_PRESERVED'; END IF;
  UPDATE activity_sessions SET ends_at = starts_at + interval '60 min' WHERE id = s45;
  IF (SELECT credits FROM activity_sessions WHERE id = s45) <> 2
     OR (SELECT credits_granted FROM attendances WHERE participant_id=pb AND activity_id=a45) <> 1
  THEN RAISE EXCEPTION 'SNAPSHOT_NOT_RAISED_RETROACTIVELY'; END IF;

  -- 9. Publicación: las sesiones nacen con los sellos de su duración.
  SELECT c.id INTO real_career FROM careers c JOIN divisions d ON d.id = c.division_id
  WHERE c.is_active AND NOT c.is_demo AND NOT d.is_demo ORDER BY c.id LIMIT 1;
  IF real_career IS NULL THEN RAISE EXCEPTION 'TEST_FIXTURE_MISSING'; END IF;
  payload := jsonb_build_object(
    'facilitator_name','Sellos Prueba','facilitator_email','sixb.credits.fac@test.invalid',
    'activity_type','academica','experience_category',null,
    'title','6B Sellos publicado 60','student_pitch','Descripción para el alumno.',
    'objective','Aprender algo nuevo.','takeaway','Una experiencia concreta.',
    'keywords',jsonb_build_array('prueba','sellos','duracion'),
    'session_duration_minutes',60,'capacity_per_session',20,
    'building','Edificio A','room_space','Aula 1','requirements',null,'notes',null,
    'career_ids',jsonb_build_array(real_career));
  sub60 := (create_workshop_submission_internal(payload)->>'submission_id')::uuid;
  sub30 := (create_workshop_submission_internal(payload || jsonb_build_object('title','6B Sellos publicado 30','session_duration_minutes',30))->>'submission_id')::uuid;
  act60 := (publish_workshop_submission_internal(coord, sub60)->>'activity_id')::uuid;
  act30 := (publish_workshop_submission_internal(coord, sub30)->>'activity_id')::uuid;
  IF (SELECT count(*) FROM activity_sessions WHERE activity_id = act60) < 1
     OR EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act60 AND (ends_at - starts_at <> interval '60 min' OR credits <> 2))
  THEN RAISE EXCEPTION 'PUBLISH_60_TWO_STAMPS'; END IF;
  IF (SELECT count(*) FROM activity_sessions WHERE activity_id = act30) < 1
     OR EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act30 AND (ends_at - starts_at <> interval '30 min' OR credits <> 1))
  THEN RAISE EXCEPTION 'PUBLISH_30_ONE_STAMP'; END IF;

  -- 10. Edición de un taller publicado: cambiar la duración recalcula los sellos en ambos sentidos.
  PERFORM workshop_admin_edit_internal(coord, sub30, payload || jsonb_build_object('title','6B Sellos publicado 30','session_duration_minutes',60));
  IF (SELECT count(*) FROM activity_sessions WHERE activity_id = act30) < 1
     OR EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act30 AND (ends_at - starts_at <> interval '60 min' OR credits <> 2))
  THEN RAISE EXCEPTION 'EDIT_30_TO_60_TWO_STAMPS'; END IF;
  PERFORM workshop_admin_edit_internal(coord, sub60, payload || jsonb_build_object('session_duration_minutes',30));
  IF (SELECT count(*) FROM activity_sessions WHERE activity_id = act60) < 1
     OR EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act60 AND (ends_at - starts_at <> interval '30 min' OR credits <> 1))
  THEN RAISE EXCEPTION 'EDIT_60_TO_30_ONE_STAMP'; END IF;
  -- Editar sin cambiar la duración (cupo) conserva los sellos.
  PERFORM workshop_admin_edit_internal(coord, sub30, payload || jsonb_build_object('title','6B Sellos publicado 30','session_duration_minutes',60,'capacity_per_session',25));
  IF EXISTS (SELECT 1 FROM activity_sessions WHERE activity_id = act30 AND (credits <> 2 OR capacity <> 25))
  THEN RAISE EXCEPTION 'EDIT_CAPACITY_KEEPS_STAMPS'; END IF;

  -- 11. Importación de catálogo: alta de 60 y de 45 minutos, y reimportación que cambia el horario.
  PERFORM process_catalog_import('workshops', jsonb_build_array(
    jsonb_build_object('division','sixb-credits','title','6B Sellos importado 60','start','10:00','end','11:00','capacity',10),
    jsonb_build_object('division','sixb-credits','title','6B Sellos importado 45','start','10:00','end','10:45','capacity',10)),
    true, gen_random_uuid());
  IF (SELECT s.credits FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title = '6B Sellos importado 60') <> 2
     OR (SELECT s.credits FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title = '6B Sellos importado 45') <> 1
  THEN RAISE EXCEPTION 'IMPORT_STAMPS'; END IF;
  PERFORM process_catalog_import('workshops', jsonb_build_array(
    jsonb_build_object('division','sixb-credits','title','6B Sellos importado 60','start','10:00','end','10:30','capacity',10),
    jsonb_build_object('division','sixb-credits','title','6B Sellos importado 45','start','10:00','end','11:00','capacity',10)),
    true, gen_random_uuid());
  IF (SELECT s.credits FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title = '6B Sellos importado 60') <> 1
     OR (SELECT s.credits FROM activity_sessions s JOIN activities a ON a.id = s.activity_id WHERE a.title = '6B Sellos importado 45') <> 2
  THEN RAISE EXCEPTION 'REIMPORT_STAMPS'; END IF;

  -- 12. La asistencia NACE con los sellos oficiales, envíe lo que envíe quien la inserta. Es lo que protege a un
  --     check-in que estaba en curso con la función anterior cuando se instaló la regla.
  INSERT INTO attendances(participant_id,session_id,activity_id,credits_granted,method)
  SELECT pb, id, activity_id, 1, 'qr' FROM activity_sessions WHERE activity_id = act30 ORDER BY starts_at LIMIT 1;   -- 60 min, se envía 1
  INSERT INTO attendances(participant_id,session_id,activity_id,credits_granted,method) VALUES (pb, s30, a30, 5, 'qr');   -- 30 min, se envía 5
  INSERT INTO attendances(participant_id,session_id,activity_id,method) VALUES (pb, s61, a61, 'codigo_manual');           -- 61 min, sin valor
  IF (SELECT credits_granted FROM attendances WHERE participant_id = pb AND activity_id = act30) <> 2
     OR (SELECT credits_granted FROM attendances WHERE participant_id = pb AND activity_id = a30) <> 1
     OR (SELECT credits_granted FROM attendances WHERE participant_id = pb AND activity_id = a61) <> 1
  THEN RAISE EXCEPTION 'ATTENDANCE_BORN_WITH_OFFICIAL_CREDITS[%]',
    (SELECT string_agg(credits_granted::text, ',' ORDER BY recorded_at, id) FROM attendances WHERE participant_id = pb); END IF;
  -- El snapshot solo se fija al insertar: tocar la fila después no lo recalcula (pb conserva su 1 en la sesión que
  -- hoy dura 60 minutos, ver paso 8).
  UPDATE attendances SET method = method WHERE participant_id = pb;
  IF (SELECT credits_granted FROM attendances WHERE participant_id = pb AND activity_id = a45) <> 1
  THEN RAISE EXCEPTION 'SNAPSHOT_RECOMPUTED_ON_UPDATE'; END IF;

  -- 13. Ninguna sesión de la base queda fuera de la regla.
  IF EXISTS (SELECT 1 FROM activity_sessions WHERE credits <> session_stamp_credits(starts_at, ends_at))
  THEN RAISE EXCEPTION 'SESSIONS_OUT_OF_RULE'; END IF;

  RAISE NOTICE 'ASISTENCIA_SELLOS_OK: regla 60=2, QR y código manual, reintentos, snapshot, sellos fijados al insertar, publicación, edición e importación';
END $credits$;
ROLLBACK;
