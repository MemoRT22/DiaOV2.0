-- Regresión de `activity_export_metadata()` (descarga masiva de QR de talleres). Ejecutar con psql -v ON_ERROR_STOP=1 en una
-- base local/descartable con la migración 20261013120000 cargada. Fixtures DEMO; toda la transacción termina con ROLLBACK.
-- Éxito: la sentencia aborta a propósito con el mensaje EXPORT_METADATA_OK (revierte todo); cualquier otro mensaje es un fallo.
--
-- Contrato probado: solo Coordinación; solo lectura; sin tokens ni códigos; no depende del modo de la edición ni de is_demo;
-- divisiones reales sin inventar (taller sin división = lista vacía, no se descarta); responsable de la propuesta publicada;
-- las credenciales siguen saliendo de activity_credential_display (misma credencial antes y después, sin rotar).
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
  coord uuid := gen_random_uuid(); staff uuid := gen_random_uuid(); student uuid := gen_random_uuid();
  d1 uuid; d2 uuid; c1 uuid; c2 uuid; c3 uuid;
  a_multi uuid; a_vida uuid; a_demo uuid; a_cancel uuid; a_nocred uuid; a_legacy uuid;
  sub uuid;
  meta jsonb; row jsonb; answer text; mode_before text; pass int := 0; fail int := 0; msg text := '';
  display_before jsonb; display_after jsonb;
BEGIN
  INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','em.'||right(u::text,4)||'@test.invalid','{}','{}',now(),now()
  FROM unnest(ARRAY[coord, staff, student]) u;
  INSERT INTO staff_members(user_id,role,full_name,is_active,email) VALUES
    (coord,'coordinacion','EM Coord',true,'em.coord@test.invalid'),(staff,'staff','EM Staff',true,'em.staff@test.invalid');
  INSERT INTO staff_roles(user_id,role) VALUES (coord,'coordinacion'),(staff,'staff');

  INSERT INTO divisions(code,name,sort_order,is_demo) VALUES ('em-d1','EM División Uno',9001,true) RETURNING id INTO d1;
  INSERT INTO divisions(code,name,sort_order,is_demo) VALUES ('em-d2','EM División Dos',9002,true) RETURNING id INTO d2;
  INSERT INTO careers(code,name,division_id,is_demo) VALUES ('em-c1','EM Carrera A',d1,true) RETURNING id INTO c1;
  INSERT INTO careers(code,name,division_id,is_demo) VALUES ('em-c2','EM Carrera B',d2,true) RETURNING id INTO c2;
  INSERT INTO careers(code,name,division_id,is_demo) VALUES ('em-c3','EM Carrera C',d1,true) RETURNING id INTO c3;

  -- Taller real, dos divisiones por carreras, tres horarios (uno cancelado), responsable y edificio.
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type)
    VALUES (ed,NULL,'EM Taller multi-división','Edificio 1 Sala 2',false,'academica') RETURNING id INTO a_multi;
  INSERT INTO activity_careers(activity_id,career_id) VALUES (a_multi,c1),(a_multi,c2);
  INSERT INTO activity_divisions(activity_id,division_id) VALUES (a_multi,d1),(a_multi,d2);
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits) VALUES
    (a_multi, now()+interval '1 day', now()+interval '1 day 1 hour', 10, 'Edificio 1 Sala 2','activa',false,2),
    (a_multi, now()+interval '1 day 2 hours', now()+interval '1 day 3 hours', 10, 'Edificio 3 Sala 9','activa',false,2),
    (a_multi, now()+interval '1 day 4 hours', now()+interval '1 day 5 hours', 10, 'Edificio 1 Sala 2','cancelada',false,2);
  INSERT INTO workshop_submissions(edition_id,status,is_demo,submitted_at,facilitator_name,facilitator_email,activity_type,title,student_pitch,
    objective,takeaway,keywords,session_duration_minutes,capacity_per_session,building,room_space,published_activity_id)
  VALUES (ed,'published',false,now(),'EM Tallerista Uno','EM.Uno@Test.Invalid','academica','EM Taller multi-división','p','o','t',
    ARRAY['a','b','c'],60,10,'Edificio 1','Sala 2',a_multi) RETURNING id INTO sub;
  INSERT INTO workshop_submission_careers(submission_id,career_id) VALUES (sub,c1),(sub,c2);
  PERFORM rotate_activity_credential(a_multi);

  -- Vida Universitaria real, sin división ni carrera, sin propuesta (alta manual).
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type,experience_category)
    VALUES (ed,NULL,'EM Vida Universitaria','Cancha','false'::boolean,'vida_universitaria','deportiva') RETURNING id INTO a_vida;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
    VALUES (a_vida, now()+interval '1 day', now()+interval '1 day 30 minutes', 10, '','activa',false,1);
  PERFORM rotate_activity_credential(a_vida);

  -- DEMO.
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type) VALUES (ed,d1,'EM Taller DEMO','Aula',true,'academica') RETURNING id INTO a_demo;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
    VALUES (a_demo, now()+interval '1 day', now()+interval '1 day 1 hour', 10, '','activa',true,2);
  PERFORM rotate_activity_credential(a_demo);

  -- Solo horarios cancelados.
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type) VALUES (ed,d2,'EM Taller cancelado','Aula',false,'academica') RETURNING id INTO a_cancel;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
    VALUES (a_cancel, now()+interval '1 day', now()+interval '1 day 1 hour', 10, '','cancelada',false,2);
  PERFORM rotate_activity_credential(a_cancel);

  -- Sin credencial (se borra la fila de prueba: la función debe informarlo, no inventar una).
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type) VALUES (ed,d1,'EM Taller sin credencial','Aula',false,'academica') RETURNING id INTO a_nocred;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
    VALUES (a_nocred, now()+interval '1 day', now()+interval '1 day 1 hour', 10, '','activa',false,2);
  DELETE FROM activity_credentials WHERE activity_id = a_nocred;

  -- Heredado: solo activities.division_id, sin activity_divisions ni carreras.
  INSERT INTO activities(edition_id,division_id,title,location,is_demo,activity_type) VALUES (ed,d2,'EM Taller heredado','Aula',false,'academica') RETURNING id INTO a_legacy;
  INSERT INTO activity_sessions(activity_id,starts_at,ends_at,capacity,location,status,is_demo,credits)
    VALUES (a_legacy, now()+interval '1 day', now()+interval '1 day 1 hour', 10, '','activa',false,2);
  PERFORM rotate_activity_credential(a_legacy);

  -- ====== PRUEBAS ======
  -- 1. Permisos: solo Coordinación.
  answer := pg_temp.as_user(staff, 'select activity_export_metadata()::text');
  IF answer = 'ERR:NOT_AUTHORIZED' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL staff recibió: ' || left(coalesce(answer,'null'),80); END IF;
  answer := pg_temp.as_user(student, 'select activity_export_metadata()::text');
  IF answer = 'ERR:NOT_AUTHORIZED' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL participante recibió: ' || left(coalesce(answer,'null'),80); END IF;
  answer := pg_temp.as_anon('select activity_export_metadata()::text');
  IF answer LIKE 'ERR:%' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL anónimo recibió datos'; END IF;
  answer := pg_temp.as_user(coord, 'select jsonb_typeof(activity_export_metadata())');
  IF answer = 'array' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL Coordinación no recibió arreglo: ' || coalesce(answer,'null'); END IF;

  SELECT (pg_temp.as_user(coord, 'select activity_export_metadata()::text'))::jsonb INTO meta;
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_multi::text;

  -- 2. Taller multi-división: divisiones únicas reales, carreras, responsable normalizado, edificio, horarios con su ubicación.
  IF jsonb_array_length(row->'divisions') = 2 AND row->'divisions'->0->>'name' = 'EM División Uno' AND row->'divisions'->1->>'name' = 'EM División Dos'
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL divisiones del multi-división: ' || (row->'divisions')::text; END IF;
  IF jsonb_array_length(row->'careers') = 2 THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL carreras'; END IF;
  IF row->>'facilitator_name' = 'EM Tallerista Uno' AND row->>'facilitator_email' = 'em.uno@test.invalid' AND row->>'building' = 'Edificio 1' AND row->>'room_space' = 'Sala 2'
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL responsable/edificio: ' || row::text; END IF;
  IF jsonb_array_length(row->'sessions') = 3 AND (SELECT count(*) FROM jsonb_array_elements(row->'sessions') s WHERE s->>'status' = 'cancelada') = 1
    AND (SELECT count(DISTINCT s->>'location') FROM jsonb_array_elements(row->'sessions') s) = 2
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL horarios'; END IF;
  IF (row->>'has_credential')::boolean AND row->>'credential_rotated_at' IS NOT NULL THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL has_credential'; END IF;
  IF (row->>'is_demo')::boolean = false AND row->>'activity_type' = 'academica' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL tipo/demo'; END IF;

  -- 3. Sin tokens ni material de credencial en ninguna parte de la respuesta.
  IF meta::text !~* '(qr_token|manual_code|encrypted|hash)' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL la respuesta contiene material de credencial'; END IF;

  -- 4. Vida Universitaria sin división/carrera/responsable: aparece, con listas vacías y responsable nulo.
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_vida::text;
  IF row IS NOT NULL AND row->'divisions' = '[]'::jsonb AND row->'careers' = '[]'::jsonb AND row->'facilitator_name' = 'null'::jsonb AND row->'facilitator_email' = 'null'::jsonb
    AND row->>'experience_category' = 'deportiva' AND row->>'activity_type' = 'vida_universitaria'
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL vida universitaria: ' || coalesce(row::text,'sin fila'); END IF;

  -- 5. DEMO se devuelve marcado (la pantalla decide); cancelado y sin credencial se devuelven con su estado real.
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_demo::text;
  IF row IS NOT NULL AND (row->>'is_demo')::boolean THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL DEMO'; END IF;
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_cancel::text;
  IF row IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(row->'sessions') s WHERE s->>'status' = 'activa') THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL cancelado'; END IF;
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_nocred::text;
  IF row IS NOT NULL AND NOT (row->>'has_credential')::boolean AND row->'credential_rotated_at' = 'null'::jsonb THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL sin credencial'; END IF;

  -- 6. Heredado: la división viene de activities.division_id.
  SELECT m INTO row FROM jsonb_array_elements(meta) m WHERE m->>'activity_id' = a_legacy::text;
  IF row IS NOT NULL AND jsonb_array_length(row->'divisions') = 1 AND row->'divisions'->0->>'name' = 'EM División Dos' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL heredado'; END IF;

  -- 7. Solo lee: ni credenciales ni datos cambian; la credencial mostrada es la misma antes y después de consultar los metadatos.
  SELECT (pg_temp.as_user(coord, format('select activity_credential_display(%L::uuid)::text', a_multi)))::jsonb INTO display_before;
  PERFORM pg_temp.as_user(coord, 'select activity_export_metadata()::text');
  SELECT (pg_temp.as_user(coord, format('select activity_credential_display(%L::uuid)::text', a_multi)))::jsonb INTO display_after;
  IF display_before->>'qr_token' IS NOT NULL AND display_before->>'qr_token' = display_after->>'qr_token' AND display_before->>'manual_code' = display_after->>'manual_code'
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL la credencial cambió'; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE proname = 'activity_export_metadata') = 's' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL la función no es STABLE'; END IF;

  -- 8. No depende del modo de la edición: mismo resultado en preparacion y operacion_real.
  SELECT mode INTO mode_before FROM editions WHERE id = ed;
  UPDATE editions SET mode = 'preparacion' WHERE id = ed;
  answer := pg_temp.as_user(coord, format('select count(*) from jsonb_array_elements(activity_export_metadata()) m where m->>%L = %L', 'activity_id', a_multi));
  IF answer = '1' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL preparacion'; END IF;
  UPDATE editions SET mode = 'operacion_real' WHERE id = ed;
  answer := pg_temp.as_user(coord, format('select count(*) from jsonb_array_elements(activity_export_metadata()) m where m->>%L = %L', 'activity_id', a_multi));
  IF answer = '1' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL operacion_real'; END IF;
  UPDATE editions SET mode = mode_before WHERE id = ed;

  -- 9. Sin permisos de tabla nuevos: la función no concede lectura de activity_divisions ni workshop_submissions.
  answer := pg_temp.as_user(coord, 'select count(*) from activity_divisions');
  IF answer LIKE 'ERR:%' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL activity_divisions quedó legible'; END IF;
  answer := pg_temp.as_user(coord, 'select count(*) from workshop_submissions');
  IF answer LIKE 'ERR:%' THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL workshop_submissions quedó legible'; END IF;
  IF NOT has_function_privilege('anon', 'public.activity_export_metadata()', 'EXECUTE') AND has_function_privilege('authenticated', 'public.activity_export_metadata()', 'EXECUTE')
    THEN pass := pass+1; ELSE fail := fail+1; msg := msg || E'\nFAIL privilegios de EXECUTE'; END IF;

  IF fail = 0 THEN RAISE EXCEPTION E'EXPORT_METADATA_OK: % passed, 0 failed', pass;
  ELSE RAISE EXCEPTION E'EXPORT_METADATA_FAILED: % passed, % failed%', pass, fail, msg; END IF;
END
$test$;
ROLLBACK;
