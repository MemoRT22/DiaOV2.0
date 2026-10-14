-- Concurrencia real de la encuesta de salida: SEIS envíos simultáneos de la misma persona (conexiones distintas, vía dblink) y otros
-- de dos personas a la vez. Base local/descartable: los fixtures se CONFIRMAN (dblink usa otras conexiones) y se borran al final.
-- Ejecutar como superusuario local (dblink lo exige): psql -U supabase_admin -d postgres -f concurrency_exit_survey.sql   (SIN ON_ERROR_STOP,
-- para que la limpieza final corra aunque falle la carrera). Éxito: «EXIT_SURVEY_CONCURRENCY_OK» y, para cada persona, exactamente una fila y
-- exactamente un envío con saved = true.
CREATE EXTENSION IF NOT EXISTS dblink;
DO $setup$
DECLARE ed uuid := active_edition_id(); u uuid; pid uuid; k int;
BEGIN
  IF (SELECT mode FROM editions WHERE id = ed) <> 'preparacion' THEN RAISE EXCEPTION 'TEST_REQUIRES_PREPARACION'; END IF;
  FOR k IN 1..2 LOOP
    u := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ecs.' || k || '@test.invalid', '{}', '{}', now(), now());
    INSERT INTO participants (edition_id, email, full_name, origin, is_demo, auth_user_id)
    VALUES (ed, 'ecs.' || k || '@test.invalid', 'ECS ' || k, 'demo', true, u) RETURNING id INTO pid;
    INSERT INTO participant_profiles (participant_id, auth_user_id, display_name) VALUES (pid, u, 'ECS ' || k)
    ON CONFLICT (participant_id) DO UPDATE SET display_name = EXCLUDED.display_name;
    UPDATE participant_profiles pp SET platform_consent_version = e.privacy_notice_version, platform_consent_at = now()
    FROM editions e WHERE e.id = ed AND pp.participant_id = pid;
  END LOOP;
END $setup$;

DO $race$
DECLARE
  users uuid[] := ARRAY(SELECT auth_user_id FROM participants WHERE email LIKE 'ecs.%@test.invalid' ORDER BY email);
  conn text; i int; k int; sql text; res jsonb; saved int; done int; rows_a int; rows_b int; failed text := '';
  names text[] := '{}';
BEGIN
  -- Una conexión «retenedora» bloquea la fila de cada persona; los 3 envíos de cada una se lanzan y quedan en cola sobre ese bloqueo.
  -- Al liberarlo compiten de verdad (en el servidor se serializan por la fila del participante).
  PERFORM dblink_connect('ecs_holder', 'dbname=' || current_database() || ' user=' || current_user);
  PERFORM dblink_exec('ecs_holder', 'begin');
  PERFORM * FROM dblink('ecs_holder', format('select 1 from participants where auth_user_id in (%L, %L) for update', users[1], users[2])) AS t(x int);
  FOR k IN 1..2 LOOP
    FOR i IN 1..3 LOOP
      conn := format('ecs_%s_%s', k, i);
      PERFORM dblink_connect(conn, 'dbname=' || current_database() || ' user=' || current_user);
      PERFORM dblink_exec(conn, format('set request.jwt.claim.sub = %L', users[k]));
      PERFORM dblink_exec(conn, format('set request.jwt.claims = %L', jsonb_build_object('sub', users[k], 'role', 'authenticated')::text));
      PERFORM dblink_exec(conn, 'set role authenticated');
      sql := format($q$select submit_exit_survey(%L::jsonb)::text$q$,
        jsonb_build_object('version', exit_survey_version(), 'q1', 'sin_idea', 'q2', 1 + i, 'q3', 'seguir_explorando', 'q4', jsonb_build_array('salud'), 'q5', i, 'comment', 'envío ' || i)::text);
      PERFORM dblink_send_query(conn, sql);
      names := names || conn;
    END LOOP;
  END LOOP;
  PERFORM pg_sleep(1);
  -- Los seis siguen esperando el bloqueo (ninguno ha respondido).
  IF EXISTS (SELECT 1 FROM unnest(names) AS c WHERE dblink_is_busy(c) = 0) THEN failed := failed || E'\nalgún envío no esperó la fila del participante'; END IF;
  PERFORM dblink_exec('ecs_holder', 'commit');
  PERFORM dblink_disconnect('ecs_holder');
  FOR k IN 1..2 LOOP
    saved := 0; done := 0;
    FOR i IN 1..3 LOOP
      conn := format('ecs_%s_%s', k, i);
      SELECT t.r::jsonb INTO res FROM dblink_get_result(conn) AS t(r text);
      IF (res->>'saved')::boolean THEN saved := saved + 1; END IF;
      IF (res->>'saved')::boolean OR (res->>'already_completed')::boolean THEN done := done + 1; END IF;
    END LOOP;
    IF saved <> 1 THEN failed := failed || format(E'\npersona %s: %s envíos guardaron (debía ser 1)', k, saved); END IF;
    IF done <> 3 THEN failed := failed || format(E'\npersona %s: %s de 3 respondieron bien', k, done); END IF;
  END LOOP;
  FOREACH conn IN ARRAY names LOOP PERFORM dblink_disconnect(conn); END LOOP;
  SELECT count(*) INTO rows_a FROM exit_survey_responses r JOIN participants p ON p.id = r.participant_id WHERE p.email = 'ecs.1@test.invalid';
  SELECT count(*) INTO rows_b FROM exit_survey_responses r JOIN participants p ON p.id = r.participant_id WHERE p.email = 'ecs.2@test.invalid';
  IF rows_a <> 1 OR rows_b <> 1 THEN failed := failed || format(E'\nfilas: %s y %s (debía ser 1 y 1)', rows_a, rows_b); END IF;
  -- La respuesta guardada es ÍNTEGRA de un solo envío (no una mezcla): q2 = 1 + i, q5 = i, comentario = «envío i».
  IF EXISTS (SELECT 1 FROM exit_survey_responses r JOIN participants p ON p.id = r.participant_id
             WHERE p.email LIKE 'ecs.%@test.invalid' AND NOT (r.q2_workshop_rating = r.q5_recommend + 1 AND r.improvement_comment = 'envío ' || r.q5_recommend)) THEN
    failed := failed || E'\nrespuesta mezclada de varios envíos';
  END IF;
  IF failed <> '' THEN RAISE EXCEPTION 'EXIT_SURVEY_CONCURRENCY_FAIL: %', failed; END IF;
  RAISE NOTICE 'EXIT_SURVEY_CONCURRENCY_OK: 3 envíos simultáneos por persona → 1 fila, 1 guardado y 2 «ya completada»; respuesta íntegra';
END $race$;

DO $cleanup$
BEGIN
  DELETE FROM participants WHERE email LIKE 'ecs.%@test.invalid';
  DELETE FROM auth.users WHERE email LIKE 'ecs.%@test.invalid';
END $cleanup$;
DROP EXTENSION IF EXISTS dblink;
