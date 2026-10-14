-- Regresión de la conciliación de sellos (`reconcile_attendance_credits`). Ejecutar con psql -v ON_ERROR_STOP=1 en una
-- base local/descartable. Fixtures DEMO; toda la transacción termina con ROLLBACK. Éxito: CONCILIACION_SELLOS_OK, salida 0.
--
-- Una asistencia «histórica» se simula como quedó en producción: se inserta (nace con los sellos oficiales) y después
-- se rebaja su snapshot a 1, que es lo que otorgaba la regla anterior.
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
CREATE FUNCTION pg_temp.as_role(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE answer text;
BEGIN
  PERFORM set_config('role',p_role,true);
  BEGIN EXECUTE p_sql INTO answer; EXCEPTION WHEN others THEN answer := 'ERR:' || SQLERRM; END;
  PERFORM set_config('role','postgres',true);
  RETURN answer;
END $f$;
DO $test$
DECLARE
  ed uuid := active_edition_id();
  div_id uuid; u uuid[] := ARRAY[]::uuid[]; p uuid[] := ARRAY[]::uuid[]; i int;
  a_h60 uuid; a_h30 uuid; a_ext uuid; a_short uuid; a_vida uuid; a_other uuid;
  s_h60 uuid; s_h30 uuid; s_ext uuid; s_short uuid; s_vida uuid; s_other uuid;
  r1 uuid; r2 uuid; r5 uuid; r6 uuid; r7 uuid; rv uuid;
  cred jsonb; answer text; result jsonb; before_rows int; before_sum int;
  cat_ss uuid; cat_ga uuid; prize uuid; winner_before text;
BEGIN
  INSERT INTO divisions(code,name,sort_order,is_demo) VALUES ('rc-div','RC Conciliación DEMO',9997,true) RETURNING id INTO div_id;
  FOR i IN 1..8 LOOP
    u := u || gen_random_uuid();
    INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES (u[i],'00000000-0000-0000-0000-000000000000','authenticated','authenticated','rc.'||i||'@test.invalid','{}','{}',now(),now());
    INSERT INTO participants(edition_id,email,full_name,origin,is_demo,auth_user_id)
    VALUES (ed,'rc.'||i||'@test.invalid','RC Alumno '||i||' DEMO','demo',true,u[i]);
    p := p || (SELECT id FROM participants WHERE email = 'rc.'||i||'@test.invalid');
  END LOOP;
  UPDATE participant_profiles pp SET platform_consent_version=e.privacy_notice_version,platform_consent_at=now()
  FROM participants x JOIN editions e ON e.id=x.edition_id WHERE pp.participant_id=x.id AND x.email LIKE 'rc.%@test.invalid';

  INSERT INTO activities(edition_id,division_id,title,is_demo,activity_type) VALUES (ed,div_id,'RC Histórico 60',true,'academica') RETURNING id INTO a_h60;
  INSERT INTO activities(edition_id,division_id,title,is_demo,activity_type) VALUES (ed,div_id,'RC Histórico 30',true,'academica') RETURNING id INTO a_h30;
  INSERT INTO activities(edition_id,division_id,title,is_demo,activity_type) VALUES (ed,div_id,'RC Alargado después',true,'academica') RETURNING id INTO a_ext;
  INSERT INTO activities(edition_id,division_id,title,is_demo,activity_type) VALUES (ed,div_id,'RC Acortado después',true,'academica') RETURNING id INTO a_short;
  INSERT INTO activities(edition_id,division_id,title,is_demo,activity_type) VALUES (ed,div_id,'RC Otra sesión',true,'academica') RETURNING id INTO a_other;
  INSERT INTO activities(edition_id,title,is_demo,activity_type,experience_category) VALUES (ed,'RC Vida 15',true,'vida_universitaria','otra') RETURNING id INTO a_vida;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_h60,now()-interval '5 min',now()+interval '55 min',50,'activa',true) RETURNING id INTO s_h60;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_h30,now()-interval '5 min',now()+interval '25 min',50,'activa',true) RETURNING id INTO s_h30;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_ext,now()-interval '5 min',now()+interval '25 min',50,'activa',true) RETURNING id INTO s_ext;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_short,now()-interval '5 min',now()+interval '55 min',50,'activa',true) RETURNING id INTO s_short;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_other,now()-interval '5 min',now()+interval '25 min',50,'activa',true) RETURNING id INTO s_other;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,status,is_demo) VALUES (a_vida,now()-interval '5 min',now()+interval '10 min',50,'activa',true) RETURNING id INTO s_vida;
  cred := rotate_activity_credential(a_h60);

  -- p1: reservación VIGENTE en la sesión de 60 min; asistencia histórica con 1 sello. Además 1 sello de Vida Universitaria.
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[1],s_h60,a_h60) RETURNING id INTO r1;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[1],s_h60,a_h60,'qr',r1);
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[1],s_vida,a_vida) RETURNING id INTO rv;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[1],s_vida,a_vida,'qr',rv);
  -- p2: reservación EXPIRADA en la sesión de 60 min; asistencia histórica con 1 sello. Es ganador confirmado.
  INSERT INTO reservations(participant_id,session_id,activity_id,status,ended_at) VALUES (p[2],s_h60,a_h60,'expirada',now()) RETURNING id INTO r2;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[2],s_h60,a_h60,'codigo_manual',r2);
  -- p3: asistencias correctas (60 min = 2 por check_in real; 30 min = 1).
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[3],s_h60,a_h60),(p[3],s_h30,a_h30);
  answer := pg_temp.as_user(u[3],format('select check_in(%L)',cred->>'qr_token'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 2 THEN RAISE EXCEPTION 'FIXTURE_CHECKIN[%]',answer; END IF;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id)
  SELECT p[3],s_h30,a_h30,'qr',id FROM reservations WHERE participant_id = p[3] AND session_id = s_h30;
  -- p4: asistencia sin reservación asociada (no hay prueba del horario histórico).
  INSERT INTO attendances(participant_id,session_id,activity_id,method) VALUES (p[4],s_h60,a_h60,'qr');
  -- p5: asistió cuando la sesión duraba 30 min (1 sello, correcto); después se liberó la reservación y se alargó a 60.
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[5],s_ext,a_ext) RETURNING id INTO r5;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[5],s_ext,a_ext,'qr',r5);
  -- p6: su `reservation_id` apunta a una reservación vigente de OTRA sesión.
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[6],s_other,a_other) RETURNING id INTO r6;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[6],s_h60,a_h60,'qr',r6);
  -- p7: asistió cuando la sesión duraba 60 min (2 sellos, correcto); después se liberó la reservación y se acortó a 30.
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[7],s_short,a_short) RETURNING id INTO r7;
  INSERT INTO attendances(participant_id,session_id,activity_id,method,reservation_id) VALUES (p[7],s_short,a_short,'qr',r7);

  -- La regla anterior: 1 sello también en las sesiones de 60 minutos.
  UPDATE attendances SET credits_granted = 1 WHERE session_id = s_h60 AND participant_id IN (p[1],p[2],p[4],p[6]);

  -- Invariante en el que se apoya la conciliación: con una reservación vigente o expirada el horario NO se puede editar.
  BEGIN
    UPDATE activity_sessions SET ends_at = ends_at - interval '30 min' WHERE id = s_h60;
    RAISE EXCEPTION 'SCHEDULE_NOT_LOCKED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'SESSION_TIMES_LOCKED' THEN RAISE; END IF; END;
  BEGIN
    UPDATE activity_sessions SET ends_at = ends_at + interval '30 min' WHERE id = s_ext;
    RAISE EXCEPTION 'SCHEDULE_NOT_LOCKED';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'SESSION_TIMES_LOCKED' THEN RAISE; END IF; END;
  -- Ediciones posteriores del horario (solo posibles al liberar las reservaciones).
  UPDATE reservations SET status='cancelada_sesion', ended_at=now() WHERE id IN (r5, r7);
  UPDATE activity_sessions SET ends_at = starts_at + interval '60 min' WHERE id = s_ext;
  UPDATE activity_sessions SET ends_at = starts_at + interval '30 min' WHERE id = s_short;

  -- Sorteo antes de conciliar: p1 tiene 1 + 1 (Sistema Solar); p2 es ganador confirmado.
  SELECT id INTO cat_ss FROM raffle_categories WHERE edition_id = ed AND is_demo AND name = 'Sistema Solar';
  SELECT id INTO cat_ga FROM raffle_categories WHERE edition_id = ed AND is_demo AND name = 'Galaxia';
  IF participant_stamp_category(p[1]) IS DISTINCT FROM cat_ss THEN RAISE EXCEPTION 'FIXTURE_CATEGORY_P1'; END IF;
  INSERT INTO raffle_prizes(edition_id,category_id,name,quantity,is_active,sort_order,is_demo) VALUES (ed,cat_ss,'RC Premio',1,true,1,true) RETURNING id INTO prize;
  INSERT INTO exit_survey_responses(edition_id,participant_id,survey_version,is_demo,q1_prior_clarity,q2_workshop_rating,q3_post_clarity,q4_areas,q5_recommend)
    VALUES (ed,p[2],exit_survey_version(),true,'sin_idea',4,'seguir_explorando',ARRAY['salud'],8); -- requisito de todo resultado nuevo del sorteo
  INSERT INTO raffle_winners(edition_id,category_id,prize_id,participant_id,status,is_demo,confirmed_at) VALUES (ed,cat_ss,prize,p[2],'confirmado',true,now());
  SELECT string_agg(rw::text, '|') INTO winner_before FROM raffle_winners rw WHERE prize_id = prize;

  SELECT count(*), sum(credits_granted) INTO before_rows, before_sum FROM attendances WHERE participant_id = ANY(p);
  IF before_rows <> 9 OR before_sum <> 11 THEN RAISE EXCEPTION 'FIXTURE_TOTALS[% / %]', before_rows, before_sum; END IF;

  -- Permisos: es una operación de mantenimiento; ningún rol de la aplicación puede ejecutarla.
  IF pg_temp.as_user(u[1],'select reconcile_attendance_credits()') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_role('anon','select reconcile_attendance_credits()') NOT LIKE 'ERR:permission denied%'
     OR pg_temp.as_role('service_role','select reconcile_attendance_credits()') NOT LIKE 'ERR:permission denied%'
  THEN RAISE EXCEPTION 'RECONCILE_EXPOSED'; END IF;

  -- Sin el trigger que fija los sellos al insertar no hay garantía de conjunto cerrado: se niega a ejecutarse.
  ALTER TABLE attendances DISABLE TRIGGER attendances_set_credits;
  BEGIN
    PERFORM reconcile_attendance_credits();
    RAISE EXCEPTION 'RECONCILE_RAN_WITHOUT_TRIGGER';
  EXCEPTION WHEN others THEN IF SQLERRM <> 'CREDIT_RULE_NOT_INSTALLED' THEN RAISE; END IF; END;
  ALTER TABLE attendances ENABLE TRIGGER attendances_set_credits;
  IF (SELECT sum(credits_granted) FROM attendances WHERE participant_id = ANY(p)) <> before_sum THEN RAISE EXCEPTION 'CHANGED_WITHOUT_TRIGGER'; END IF;

  -- ===== Primera ejecución =====
  result := reconcile_attendance_credits();
  IF result <> '{"reconciled": 2, "skipped_without_reliable_schedule": 3}'::jsonb THEN RAISE EXCEPTION 'FIRST_RUN[%]', result; END IF;
  -- Se elevan exactamente las dos con horario histórico garantizado (reservación vigente / expirada).
  IF (SELECT credits_granted FROM attendances WHERE participant_id = p[1] AND session_id = s_h60) <> 2
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[2] AND session_id = s_h60) <> 2
  THEN RAISE EXCEPTION 'NOT_RECONCILED'; END IF;
  -- Sin prueba del horario histórico no se toca: sin reservación, sesión alargada después, reservación de otra sesión.
  IF (SELECT credits_granted FROM attendances WHERE participant_id = p[4] AND session_id = s_h60) <> 1
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[5] AND session_id = s_ext) <> 1
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[6] AND session_id = s_h60) <> 1
  THEN RAISE EXCEPTION 'RECONCILED_WITHOUT_RELIABLE_SCHEDULE'; END IF;
  -- Nunca reduce: la sesión acortada después conserva sus 2 sellos; lo correcto sigue igual.
  IF (SELECT credits_granted FROM attendances WHERE participant_id = p[7] AND session_id = s_short) <> 2
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[3] AND session_id = s_h60) <> 2
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[3] AND session_id = s_h30) <> 1
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[1] AND session_id = s_vida) <> 1
  THEN RAISE EXCEPTION 'CORRECT_SNAPSHOT_CHANGED'; END IF;
  -- Ni altas ni bajas: mismas filas, exactamente 2 sellos más.
  IF (SELECT count(*) FROM attendances WHERE participant_id = ANY(p)) <> before_rows
     OR (SELECT sum(credits_granted) FROM attendances WHERE participant_id = ANY(p)) <> before_sum + 2
     OR my_stamp_count(p[1]) <> 3 OR my_stamp_count(p[2]) <> 2
  THEN RAISE EXCEPTION 'ROWS_OR_TOTALS'; END IF;
  -- Auditoría: una entrada por asistencia corregida (antes, después y duración) y una por cada omitida.
  IF (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconciled'
        AND (detail->>'participant_id')::uuid IN (p[1], p[2]) AND detail->>'session_id' = s_h60::text
        AND (detail->>'credits_before')::int = 1 AND (detail->>'credits_after')::int = 2 AND (detail->>'session_minutes')::int = 60) <> 2
     OR (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconciled' AND (detail->>'participant_id')::uuid = ANY(p)) <> 2
     OR (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconcile_skipped'
        AND (detail->>'participant_id')::uuid IN (p[4], p[5], p[6]) AND (detail->>'credits_granted')::int = 1
        AND (detail->>'credits_by_current_schedule')::int = 2) <> 3
     OR (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconcile_skipped' AND (detail->>'participant_id')::uuid = ANY(p)) <> 3
  THEN RAISE EXCEPTION 'AUDIT'; END IF;
  -- Sorteo: p1 sube sola a Galaxia (2 + 1); el ganador confirmado conserva su registro intacto y no vuelve al pool.
  IF participant_stamp_category(p[1]) IS DISTINCT FROM cat_ga THEN RAISE EXCEPTION 'CATEGORY_NOT_RECALCULATED'; END IF;
  IF (SELECT string_agg(rw::text, '|') FROM raffle_winners rw WHERE prize_id = prize) IS DISTINCT FROM winner_before
     OR NOT participant_has_won(p[2]) OR participant_stamp_category(p[2]) IS NOT NULL
  THEN RAISE EXCEPTION 'WINNER_AFFECTED'; END IF;

  -- ===== Segunda ejecución: idempotente =====
  result := reconcile_attendance_credits();
  IF result <> '{"reconciled": 0, "skipped_without_reliable_schedule": 3}'::jsonb THEN RAISE EXCEPTION 'SECOND_RUN[%]', result; END IF;
  IF (SELECT sum(credits_granted) FROM attendances WHERE participant_id = ANY(p)) <> before_sum + 2
     OR (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconciled' AND (detail->>'participant_id')::uuid = ANY(p)) <> 2
     OR (SELECT count(*) FROM audit_log WHERE action = 'attendance.credits_reconcile_skipped' AND (detail->>'participant_id')::uuid = ANY(p)) <> 3
  THEN RAISE EXCEPTION 'NOT_IDEMPOTENT'; END IF;

  -- ===== Un check-in posterior conserva su snapshot y la conciliación no lo toca =====
  INSERT INTO reservations(participant_id,session_id,activity_id) VALUES (p[8],s_h60,a_h60);
  answer := pg_temp.as_user(u[8],format('select check_in(%L)',cred->>'manual_code'));
  IF answer LIKE 'ERR:%' OR (answer::jsonb->>'credits_granted')::int <> 2 THEN RAISE EXCEPTION 'LATER_CHECKIN[%]',answer; END IF;
  result := reconcile_attendance_credits();
  IF (result->>'reconciled')::int <> 0
     OR (SELECT credits_granted FROM attendances WHERE participant_id = p[8] AND session_id = s_h60) <> 2
     OR (SELECT count(*) FROM attendances WHERE participant_id = p[8]) <> 1
  THEN RAISE EXCEPTION 'LATER_CHECKIN_TOUCHED[%]', result; END IF;

  RAISE NOTICE 'CONCILIACION_SELLOS_OK: eleva solo con horario histórico garantizado, nunca reduce, sin duplicados, idempotente, auditada, sin tocar ganadores';
END $test$;
ROLLBACK;
